const fs = require('fs');

async function check() {
  const file = "src/components/Convert.tsx";
  const data = fs.readFileSync(file, 'utf8');
  console.log("Convert.tsx lines: " + data.split('\n').length);
}

check();
