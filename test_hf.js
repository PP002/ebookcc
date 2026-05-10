async function run() {
  const res = await fetch('https://huggingface.co/api/models/bcnailab/nano-bananas');
  const data = await res.json();
  console.log(data);
}
run();
