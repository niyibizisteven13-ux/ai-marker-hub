import 'dotenv/config';
import { AiService } from '../server/services/AiService.js';

async function testNvidiaNim() {
  const aiService = AiService.getInstance();

  const hasKey = await aiService.providerAvailable('nvidianim');
  console.log('NVIDIA NIM Available:', hasKey);

  if (!hasKey) {
    console.error('NVIDIA_NIM_API_KEY not found in .env');
    return;
  }

  console.log('Testing NVIDIA NIM Streaming...');
  try {
    await aiService.streamNvidiaNimChat('Hello, who are you?', {
      onToken: (token) => process.stdout.write(token)
    });
    console.log('\nTest Completed Successfully');
  } catch (error) {
    console.error('\nTest Failed:', error);
  }
}

testNvidiaNim();
