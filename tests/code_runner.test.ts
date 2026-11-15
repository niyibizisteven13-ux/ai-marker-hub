import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeCode, normalizeCodeTests, outputsMatch, redactForStudent, type CodeTestConfig } from '../server/services/codeRunner/grade.js';
import { localUnsafeRunner } from '../server/services/codeRunner/local.js';
import { dockerRunArgs } from '../server/services/codeRunner/docker.js';
import { pickMain } from '../server/services/codeRunner/languages.js';

// Real programs in five languages are compiled and run by the development runner (no network, limits, time-outs).
const sum = (language: any, extra: Partial<CodeTestConfig> = {}): CodeTestConfig => normalizeCodeTests({
  language, ...extra,
  tests: [
    { name: 'small', input: '2 3\n', expected: '5\n', points: 2 },
    { name: 'negative', input: '-4 10\n', expected: '6', points: 2 },
    { name: 'hidden big', input: '1000000 2000000\n', expected: '3000000', points: 6, hidden: true },
  ],
})!;
const f = (path: string, text: string) => ({ path, data: Buffer.from(text) });

test('the five languages: a correct program passes every test', async () => {
  const programs: Array<[string, string, string, string]> = [
    ['python', 'main.py', 'a, b = map(int, input().split())\nprint(a + b)\n', ''],
    ['javascript', 'main.js', "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n", ''],
    ['c', 'main.c', '#include <stdio.h>\nint main(){ long a,b; scanf("%ld %ld",&a,&b); printf("%ld\\n",a+b); return 0; }\n', ''],
    ['cpp', 'main.cpp', '#include <iostream>\nint main(){ long long a,b; std::cin>>a>>b; std::cout<<a+b<<"\\n"; }\n', ''],
    ['java', 'Main.java', 'import java.util.*;\npublic class Main { public static void main(String[] x){ Scanner s=new Scanner(System.in); long a=s.nextLong(), b=s.nextLong(); System.out.println(a+b); } }\n', ''],
  ];
  for (const [lang, file, code] of programs) {
    const r = await gradeCode(localUnsafeRunner, sum(lang), [f(file, code)]);
    assert.equal(r.error, undefined, `${lang}: ${r.error}`);
    assert.equal(r.compileError, undefined, `${lang}: ${r.compileError}`);
    assert.deepEqual([r.passed, r.total, r.earned, r.max], [3, 3, 10, 10], lang);
  }
});

test('wrong answers, crashes, endless loops, memory hogs, endless output and compile errors are told apart', async () => {
  const cfg = sum('python');
  const wrong = await gradeCode(localUnsafeRunner, cfg, [f('main.py', 'a, b = map(int, input().split())\nprint(a + b + 1)\n')]);
  assert.deepEqual(wrong.tests.map((t) => t.reason), ['wrong', 'wrong', 'wrong']);
  assert.equal(wrong.earned, 0);
  const partial = await gradeCode(localUnsafeRunner, cfg, [f('main.py', 'a, b = map(int, input().split())\nprint(a + b if a < 100 else 0)\n')]);
  assert.deepEqual([partial.passed, partial.earned], [2, 4]);
  const crash = await gradeCode(localUnsafeRunner, cfg, [f('main.py', 'print(1 / 0)\n')]);
  assert.equal(crash.tests[0].reason, 'error'); assert.match(crash.tests[0].stderr ?? '', /ZeroDivisionError/);
  const loop = await gradeCode(localUnsafeRunner, sum('python', { timeSeconds: 1 } as any), [f('main.py', 'while True:\n    pass\n')]);
  assert.equal(loop.tests[0].reason, 'timeout');
  assert.ok(loop.tests[0].ms < 3500, `stopped after ${loop.tests[0].ms} ms`);
  const hog = await gradeCode(localUnsafeRunner, cfg, [f('main.py', 'x = bytearray(2000 * 1024 * 1024)\nprint(5)\n')]);
  assert.equal(hog.tests[0].reason, 'memory');
  const flood = await gradeCode(localUnsafeRunner, cfg, [f('main.py', 'while True:\n    print("x" * 1000)\n')]);
  assert.equal(flood.tests[0].reason, 'output');
  const broken = await gradeCode(localUnsafeRunner, sum('c'), [f('main.c', 'int main( { return 0 }')]);
  assert.ok(broken.compileError && /error/i.test(broken.compileError));
  assert.ok(broken.tests.every((t) => t.reason === 'compile' && !t.passed));
});

test('the program has no network and cannot keep running after its time', async () => {
  const net = 'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 80), timeout=2)\n    print("OPEN")\nexcept OSError:\n    print("blocked")\n';
  const cfg = normalizeCodeTests({ language: 'python', tests: [{ input: '', expected: 'blocked' }] })!;
  assert.equal((await gradeCode(localUnsafeRunner, cfg, [f('main.py', net)])).passed, 1, 'a connection attempt fails');
});

test('which file is the main one; a folder with no main file is reported clearly', async () => {
  assert.equal(pickMain('python', ['proj/main.py', 'proj/util.py']), 'proj/main.py');
  assert.equal(pickMain('python', ['solution.py']), 'solution.py');
  assert.equal(pickMain('python', ['a.py', 'b.py']), null);
  assert.equal(pickMain('java', ['src/Main.java', 'src/Helper.java']), 'src/Main.java');
  assert.equal(pickMain('python', ['readme.txt']), null);
  const r = await gradeCode(localUnsafeRunner, sum('python'), [f('a.py', 'print(1)'), f('b.py', 'print(2)')]);
  assert.match(r.error ?? '', /No Python main file found\. Name it main\.py/);
  assert.equal(r.passed, 0);
  // a project folder with several files and an import
  const multi = await gradeCode(localUnsafeRunner, sum('python'), [f('proj/main.py', 'from util import add\na, b = map(int, input().split())\nprint(add(a, b))\n'), f('proj/util.py', 'def add(a, b):\n    return a + b\n')]);
  assert.equal(multi.passed, 3);
});

test('output comparison: exact, whitespace-insensitive and numeric tolerance', () => {
  assert.equal(outputsMatch('5\n', '5', 'exact'), true);
  assert.equal(outputsMatch('a b\n', 'a  b', 'exact'), false);
  assert.equal(outputsMatch('a  b\n\n', 'a b', 'whitespace'), true);
  assert.equal(outputsMatch('3.0000001', '3', 'numeric'), true);
  assert.equal(outputsMatch('3.01', '3', 'numeric'), false);
  assert.equal(outputsMatch('3.0000001', '3', 'whitespace'), false);
  assert.equal(outputsMatch('Hello', 'hello', 'whitespace'), false, 'case matters');
});

test('lecturer input is cleaned; students see only what the lecturer allows; hidden tests keep their answers back', async () => {
  assert.equal(normalizeCodeTests({ language: 'cobol', tests: [{ input: '1', expected: '1' }] }), null);
  assert.equal(normalizeCodeTests({ language: 'python', tests: [] }), null);
  const c = normalizeCodeTests({ language: 'python', timeSeconds: 999, tests: [{ input: 'x'.repeat(50_000), expected: '1', points: 1000, name: '  ' }] })!;
  assert.equal(c.timeSeconds, 30); assert.equal(c.tests[0].points, 100); assert.equal(c.tests[0].input.length, 20_000); assert.equal(c.tests[0].name, 'Test 1');
  const r = await gradeCode(localUnsafeRunner, sum('python'), [f('main.py', 'a, b = map(int, input().split())\nprint(a + b)\n')]);
  assert.equal(redactForStudent(r, 'none'), null);
  assert.deepEqual(redactForStudent(r, 'summary'), { passed: 3, total: 3, earned: 10, max: 10 });
  const full: any = redactForStudent(r, 'full');
  assert.equal(full.tests[0].expected, '5\n'); assert.equal(full.tests[2].expected, undefined, 'the hidden test shows no expected output');
  assert.equal(full.tests[2].input, undefined);
});

test('the Docker runner is locked down: every protective flag is on the command line', () => {
  const a = dockerRunArgs('run-test', '/tmp/src').join(' ');
  for (const flag of ['--network none', '--cap-drop ALL', '--security-opt no-new-privileges', '--read-only', '--pids-limit', '--memory 1024m', '--user 65534:65534', '-v /tmp/src:/src:ro']) assert.ok(a.includes(flag), `missing ${flag}`);
  assert.ok(!/--privileged|docker\.sock|--network host/.test(a));
});
