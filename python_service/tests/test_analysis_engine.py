"""Deterministic analysis engine: checked against published reference values (stdlib unittest; pytest also collects it)."""
import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from analysis import engine  # noqa: E402

ENGINE = os.path.join(os.path.dirname(__file__), "..", "analysis", "engine.py")

# Anscombe's quartet, set I (Anscombe 1973): y = 3.00 + 0.500x, r = 0.816, R² = 0.667.
AX = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5]
AY = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]


def ds(rows, cols):
    return {"columns": cols, "rows": rows}


ANSCOMBE = ds([[x, y, "a" if i % 2 else "b"] for i, (x, y) in enumerate(zip(AX, AY))],
              [{"name": "x", "type": "numeric"}, {"name": "y", "type": "numeric"}, {"name": "g", "type": "categorical"}])


class Distributions(unittest.TestCase):
    def test_reference_values(self):
        self.assertAlmostEqual(engine.t_two_sided_p(2.0, 10), 0.073388, places=5)
        self.assertAlmostEqual(engine.t_quantile(0.975, 10), 2.228139, places=5)
        self.assertAlmostEqual(engine.chi2_sf(3.841459, 1), 0.05, places=5)
        self.assertAlmostEqual(engine.f_sf(4.964603, 1, 10), 0.05, places=5)


class Operations(unittest.TestCase):
    def run_ops(self, ops, dataset=ANSCOMBE, filters=None):
        return engine.run({"dataset": dataset, "operations": ops, "filters": filters or []})

    def test_regression_matches_anscombe(self):
        r = self.run_ops([{"op": "regression", "y": "y", "x": ["x"]}])["results"][0]
        b0, b1 = r["coefficients"][0]["estimate"], r["coefficients"][1]["estimate"]
        self.assertAlmostEqual(b0, 3.0001, places=4)
        self.assertAlmostEqual(b1, 0.5001, places=4)
        self.assertAlmostEqual(r["r2"], 0.6665, places=4)
        self.assertAlmostEqual(r["coefficients"][1]["p"], 0.00217, places=5)
        self.assertIn("do not show causation", r["interpretation"])

    def test_correlation_and_spearman(self):
        res = self.run_ops([{"op": "correlation", "columns": ["x", "y"]}, {"op": "correlation", "columns": ["x", "y"], "method": "spearman"}])["results"]
        self.assertAlmostEqual(res[0]["pairs"][0]["r"], 0.81642, places=5)
        self.assertEqual(res[0]["pairs"][0]["n"], 11)
        self.assertAlmostEqual(res[1]["pairs"][0]["r"], 0.81818, places=5)
        self.assertIn("association only", res[0]["interpretation"])

    def test_describe_missing_filters(self):
        d = ds([[1.0, "a"], [2.0, "b"], [None, "a"], [4.0, None]], [{"name": "v", "type": "numeric"}, {"name": "c", "type": "categorical"}])
        out = self.run_ops([{"op": "describe"}, {"op": "missing"}], dataset=d)
        v = out["results"][0]["rows"][0]
        self.assertEqual((v["n"], v["missing"], v["mean"], v["median"]), (3, 1, 7 / 3, 2.0))
        self.assertAlmostEqual(v["sd"], 1.527525, places=5)
        self.assertEqual(out["results"][1]["completeRows"], 2)
        f = self.run_ops([{"op": "describe", "columns": ["v"]}], dataset=d, filters=[{"column": "c", "op": "eq", "value": "a"}])
        self.assertEqual(f["dataset"]["rowsAnalysed"], 2)
        self.assertEqual(f["results"][0]["rows"][0]["n"], 1)

    def test_groupby_pivot_distribution_outliers_moving_average(self):
        d = ds([["A", "x", 1.0, "2024-01-01"], ["A", "y", 3.0, "2024-01-02"], ["B", "x", 5.0, "2024-01-03"], ["B", "y", 7.0, "2024-01-04"], ["B", "y", 100.0, "2024-01-05"]],
               [{"name": "g", "type": "categorical"}, {"name": "h", "type": "categorical"}, {"name": "v", "type": "numeric"}, {"name": "t", "type": "datetime"}])
        res = self.run_ops([
            {"op": "groupby", "by": ["g"], "metrics": [{"column": "v", "agg": "mean"}, {"column": "v", "agg": "count"}]},
            {"op": "pivot", "index": "g", "columns": "h", "values": "v", "agg": "sum"},
            {"op": "distribution", "column": "g"},
            {"op": "outliers", "column": "v"},
            {"op": "moving_average", "value": "v", "orderBy": "t", "window": 2},
        ], dataset=d)["results"]
        self.assertEqual([(r["g"], r["mean_v"], r["count_v"]) for r in res[0]["rows"]], [("A", 2.0, 2), ("B", 112 / 3, 3)])
        self.assertEqual(res[1]["rows"][1]["values"], [5.0, 107.0])
        self.assertEqual([r["count"] for r in res[2]["rows"]], [3, 2])
        self.assertEqual(res[3]["outliers"], [{"row": 6, "value": 100.0}])
        self.assertEqual([r["movingAverage"] for r in res[4]["rows"]], [None, 2.0, 4.0, 6.0, 53.5])

    def test_invalid_inputs_are_reported_not_guessed(self):
        res = self.run_ops([{"op": "regression", "y": "g", "x": ["x"]}, {"op": "correlation", "columns": ["x"]}, {"op": "nope"},
                            {"op": "regression", "y": "y", "x": ["x", "x2"]}], dataset=ds([[1, 2, 2], [2, 4, 4], [3, 6, 6], [4, 8, 8.0], [5, 9, 10]],
                                                                                          [{"name": "x", "type": "numeric"}, {"name": "y", "type": "numeric"}, {"name": "x2", "type": "numeric"}]))["results"]
        self.assertIn('"g" does not exist', res[0]["error"])
        self.assertIn("at least two", res[1]["error"])
        self.assertIn("Unknown operation", res[2]["error"])
        self.assertIn("collinear", res[3]["error"])


class Isolation(unittest.TestCase):
    def test_process_blocks_network_and_never_evaluates_input(self):
        req = {"dataset": ANSCOMBE, "operations": [{"op": "__import__('os').system('id')"}]}
        out = subprocess.run([sys.executable, "-I", ENGINE], input=json.dumps(req), capture_output=True, text=True, timeout=60)
        body = json.loads(out.stdout)
        self.assertIn("Unknown operation", body["results"][0]["error"])
        code = "import sys; sys.argv=['x']; exec(open(%r).read().replace('if __name__ == \"__main__\":\\n    main()', '')); _harden(); import socket\ntry:\n    socket.socket()\n    print('open')\nexcept PermissionError:\n    print('blocked')" % ENGINE
        self.assertEqual(subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, timeout=60).stdout.strip(), "blocked")


if __name__ == "__main__":
    unittest.main()
