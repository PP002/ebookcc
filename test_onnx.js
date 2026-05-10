const ort = require('onnxruntime-node');

async function test() {
  try {
    const session = await ort.InferenceSession.create('./best.onnx');
    console.log("Session created!");
    console.log("Inputs:", session.inputNames);
    console.log("Outputs:", session.outputNames);
  } catch(e) {
    console.error(e);
  }
}
test();
