const { spawn } = require('child_process');

const env = {
  ...process.env,
  JAVA_HOME: 'C:\\Program Files\\Android\\openjdk\\jdk-21.0.8',
  ANDROID_HOME: 'C:\\Users\\Yin\\AppData\\Local\\Android\\Sdk'
};

const child = spawn('bubblewrap', [
  'init',
  '--manifest', 'http://localhost:8899/manifest-local.json'
], {
  cwd: 'C:\\Users\\Yin\\WorkBuddy\\2026-06-12-10-40-19\\apk-build',
  env: env,
  shell: true
});

const answers = [
  'yty16.github.io\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  'io.github.yty16.toolbox\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
  '\r',
];

let answerIndex = 0;
let waitTimer = null;
let outputBuffer = '';

child.stdout.on('data', (data) => {
  const text = data.toString();
  outputBuffer += text;
  process.stdout.write(text);
  
  // When we see a prompt, send the next answer after a delay
  if (text.includes('? ') || text.includes(': (') || text.includes(': ')) {
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = setTimeout(() => {
      if (answerIndex < answers.length) {
        const ans = answers[answerIndex];
        console.log('\n[SENDING ANSWER ' + answerIndex + ': ' + JSON.stringify(ans) + ']');
        child.stdin.write(ans);
        answerIndex++;
      }
    }, 1000);
  }
});

child.stderr.on('data', (data) => {
  process.stderr.write(data.toString());
});

child.on('close', (code) => {
  console.log('\nProcess exited with code ' + code);
  process.exit(code);
});

// Send first answer after 3 seconds
setTimeout(() => {
  if (answerIndex < answers.length) {
    console.log('\n[SENDING FIRST ANSWER]');
    child.stdin.write(answers[answerIndex]);
    answerIndex++;
  }
}, 3000);

// Timeout after 5 minutes
setTimeout(() => {
  console.log('\nTimeout - killing process');
  child.kill();
  process.exit(1);
}, 300000);
