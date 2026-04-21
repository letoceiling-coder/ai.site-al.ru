/* eslint-disable no-console */
console.log("Worker started");

setInterval(() => {
  console.log("Worker heartbeat", new Date().toISOString());
}, 15000);
