import { PredictiveAnalyticsService } from '../server/services/PredictiveAnalyticsService.ts';

async function testRiskDetection() {
  const analytics = PredictiveAnalyticsService.getInstance();
  console.log("Starting Predictive Risk Detection Test...");

  try {
    // Note: This requires a populated DB to truly test "Sudden Logic Gaps"
    // For now, we verify the logic compiles and handles empty states.
    const results = await analytics.analyzeClassRisk('mock-form-id');
    console.log("Risk Results:", results);
  } catch (e) {
    console.error("Risk Detection Test Failed:", e);
  }
}

testRiskDetection();
