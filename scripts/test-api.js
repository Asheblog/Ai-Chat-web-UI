#!/usr/bin/env node

/**
 * API 功能测试脚本
 * 用于验证后端 API 的基本功能
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: jsonData,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data,
          });
        }
      });
    });

    req.on('error', reject);

    if (opts.body) {
      req.write(JSON.stringify(opts.body));
    }

    req.end();
  });
}

async function runTests() {
  console.log('🧪 开始 API 功能测试...\n');

  const tests = [
    {
      name: '健康检查',
      path: '/api/settings/health',
      expectedStatus: 200,
    },
    {
      name: 'API 文档',
      path: '/api',
      expectedStatus: 200,
    },
    {
      name: '应用信息',
      path: '/api/settings/app-info',
      expectedStatus: 200,
    },
    {
      name: '根路径',
      path: '/',
      expectedStatus: 200,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`🔍 测试: ${test.name}`);
      const response = await makeRequest(test.path);

      if (response.status === test.expectedStatus) {
        console.log(`✅ ${test.name} - 通过 (${response.status})`);
        if (test.name === '健康检查') {
          console.log(`   状态: ${response.data.data?.status || 'unknown'}`);
        }
        passed++;
      } else {
        console.log(`❌ ${test.name} - 失败 (期望: ${test.expectedStatus}, 实际: ${response.status})`);
        console.log(`   响应: ${JSON.stringify(response.data, null, 2)}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name} - 错误: ${error.message}`);
      failed++;
    }
    console.log('');
  }

  // 测试用户注册
  console.log('🔍 测试: 用户注册');
  try {
    const registerResponse = await makeRequest('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'testuser',
        password: 'testpass123',
      },
    });

    if (registerResponse.status === 200) {
      console.log('✅ 用户注册 - 通过');
      console.log(`   用户ID: ${registerResponse.data.data?.user?.id}`);
      console.log(`   用户名: ${registerResponse.data.data?.user?.username}`);
      console.log(`   角色: ${registerResponse.data.data?.user?.role}`);

      const token = registerResponse.data.data?.token;

      if (token) {
        // 测试获取用户信息
        console.log('\n🔍 测试: 获取用户信息');
        const userResponse = await makeRequest('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (userResponse.status === 200) {
          console.log('✅ 获取用户信息 - 通过');
          console.log(`   用户: ${userResponse.data.data?.username}`);
          passed++;
        } else {
          console.log('❌ 获取用户信息 - 失败');
          failed++;
        }
      }
      passed++;
    } else {
      console.log(`❌ 用户注册 - 失败 (${registerResponse.status})`);
      console.log(`   错误: ${registerResponse.data?.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`❌ 用户注册 - 错误: ${error.message}`);
    failed++;
  }

  console.log('\n📊 测试结果统计:');
  console.log(`✅ 通过: ${passed}`);
  console.log(`❌ 失败: ${failed}`);
  console.log(`📈 成功率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n🎉 所有测试通过！后端服务运行正常。');
    process.exit(0);
  } else {
    console.log('\n⚠️ 部分测试失败，请检查服务状态。');
    process.exit(1);
  }
}

// 检查服务是否可用
async function checkService() {
  try {
    await makeRequest('/api/settings/health');
    return true;
  } catch (error) {
    return false;
  }
}

// 主函数
async function main() {
  console.log('🔍 检查后端服务是否运行...');

  const serviceRunning = await checkService();
  if (!serviceRunning) {
    console.log('❌ 后端服务未运行，请先启动服务:');
    console.log('   npm run dev');
    console.log('   或');
    console.log('   pnpm run dev');
    process.exit(1);
  }

  console.log('✅ 后端服务运行正常\n');
  await runTests();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runTests, checkService };