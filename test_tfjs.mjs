import * as tf from '@tensorflow/tfjs';

async function test() {
  const modelUrl = 'file://' + process.cwd() + '/public/models/yolo26m-seg/model.json';
  console.log("Loading model:", modelUrl);
  const model = await tf.loadGraphModel(modelUrl);
  console.log("Model loaded.");
  console.log("Inputs:", model.inputs);
  console.log("Outputs:", model.outputs);
  
  // Create a dummy tensor of shape [1, 1280, 1280, 3] and run inference
  const dummy = tf.zeros([1, 1280, 1280, 3]);
  const res = model.predict(dummy);
  if (Array.isArray(res)) {
      console.log("Multiple outputs:");
      res.forEach((t, i) => console.log(`Output ${i} shape:`, t.shape));
  } else if (res instanceof tf.Tensor) {
      console.log("Single output shape:", res.shape);
  } else {
      console.log("Dict output:");
      for (const key of Object.keys(res)) {
          console.log(`Output ${key} shape:`, res[key].shape);
      }
  }
}
test().catch(console.error);
