#!/usr/bin/env node

// Simple test script to verify both Responses API and Chat Completions API work

const API_BASE = 'http://localhost:4001';

async function testEndpoint(endpoint, description) {
  console.log(`\n🧪 Testing ${description}...`);
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say "Hello from API test!"' }],
        model: 'gpt-3.5-turbo',
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ ${description} working!`);
    console.log(`   Object type: ${data.object}`);
    
    // Extract content based on API format
    let content = '';
    if (data.object === 'response' && data.output?.[0]?.content?.[0]?.text) {
      // Responses API format
      content = data.output[0].content[0].text;
    } else if (data.object === 'chat.completion' && data.choices?.[0]?.message?.content) {
      // Chat Completions API format
      content = data.choices[0].message.content;
    }
    
    console.log(`   Response: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    
  } catch (error) {
    console.log(`❌ ${description} failed: ${error.message}`);
  }
}

async function testStreamingEndpoint(endpoint, description) {
  console.log(`\n🌊 Testing ${description} (streaming)...`);
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Count to 3' }],
        model: 'gpt-3.5-turbo',
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log(`✅ ${description} streaming completed!`);
            console.log(`   Received ${chunks} chunks`);
            console.log(`   Content: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
            return;
          }
          
          try {
            const json = JSON.parse(data);
            chunks++;
            
            // Extract delta content based on format
            if (json.choices?.[0]?.delta?.content) {
              // Chat Completions format
              content += json.choices[0].delta.content;
            } else if (json.type === 'response.output_text.delta' && json.delta) {
              // Responses API format
              content += json.delta;
            }
            
            // Stop after a few chunks for testing
            if (chunks >= 10) {
              console.log(`✅ ${description} streaming working (stopped after 10 chunks)!`);
              console.log(`   Content so far: "${content}"`);
              return;
            }
          } catch (e) {
            // Ignore JSON parsing errors for non-data lines
          }
        }
      }
    }
  } catch (error) {
    console.log(`❌ ${description} streaming failed: ${error.message}`);
  }
}

async function main() {
  console.log('🚀 Testing API Endpoints Conversion');
  console.log('=====================================');

  // Test non-streaming endpoints
  await testEndpoint('/v1/responses', 'Responses API');
  await testEndpoint('/v1/chat/completions', 'Chat Completions API (with conversion)');

  // Test streaming endpoints
  await testStreamingEndpoint('/v1/responses', 'Responses API');
  await testStreamingEndpoint('/v1/chat/completions', 'Chat Completions API (with conversion)');

  console.log('\n🏁 API testing completed!');
}

main().catch(console.error);