/** One Engine URL supports writing and querying threads through the SDK. */
import { Threadify } from '../src/index.js';

export async function queryThread(threadId) {
  const client = Threadify.create({
    apiKey: process.env.THREADIFY_API_KEY,
    serviceName: 'my-service',
    engineUrl: process.env.THREADIFY_ENGINE_URL || 'https://threadify.example.com'
  });
  const connection = await client.connect();
  try {
    return await connection.getThread(threadId);
  } finally {
    connection.ws.close();
  }
}
