import * as ort from 'onnxruntime-node';

async function test() {
  try {
    const session = await ort.InferenceSession.create('./server_models/best.onnx');
    console.log("Session created!");
    console.log("Inputs:", session.inputNames);
    console.log("Outputs:", session.outputNames);
    const inputDims = session.inputNames.map(name => "input...");
    // we don't have access to dims easily without running it?
  } catch(e) {
    console.error(e);
  }
}
test();
