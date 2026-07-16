const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const bcrypt = require('bcryptjs');

const envPath = path.resolve(process.cwd(), '.env.local');

function prompt(query, { secret = false } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  if (!secret) {
    return new Promise((resolve) => {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const onData = (char) => {
      char = String(char);
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.removeListener('data', onData);
          break;
        default:
          readline.moveCursor(process.stdout, -rl.line.length, 0);
          readline.clearLine(process.stdout, 1);
          process.stdout.write('*'.repeat(rl.line.length));
          break;
      }
    };
    stdin.on('data', onData);
    rl.question(query, (answer) => {
      rl.history = rl.history.slice(1);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.length > 0);
}

function upsertEnv(lines, key, value) {
  const nextLine = `${key}=${value}`;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    lines.push(nextLine);
  }
}

function removeEnv(lines, key) {
  return lines.filter((line) => !line.startsWith(`${key}=`));
}

async function main() {
  const email = String(await prompt('운영관리자 이메일: ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('이메일 형식이 올바르지 않습니다.');
  }

  const password = String(await prompt('새 비밀번호: ', { secret: true }));
  if (password.length < 10) {
    throw new Error('비밀번호는 최소 10자 이상이어야 합니다.');
  }

  const confirm = String(await prompt('새 비밀번호 확인: ', { secret: true }));
  if (password !== confirm) {
    throw new Error('비밀번호 확인이 일치하지 않습니다.');
  }

  const hash = await bcrypt.hash(password, 12);
  let lines = readEnvFile(envPath);
  lines = removeEnv(lines, 'OPERATOR_PASSWORD');
  upsertEnv(lines, 'OPERATOR_EMAIL', email);
  upsertEnv(lines, 'OPERATOR_PASSWORD_HASH', hash);
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');

  console.log('운영관리자 이메일과 비밀번호 해시를 .env.local에 저장했습니다.');
  console.log('비밀번호 원문은 저장하지 않았습니다.');
  console.log('Vercel Production 환경변수에도 같은 OPERATOR_EMAIL, OPERATOR_PASSWORD_HASH 값을 반영해야 합니다.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
