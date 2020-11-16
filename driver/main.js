const { Driver } = require("./driver");
const { EmbedDriver } = require("./embedsdriver");
const he = require("he");


// ================================================================================================
async function main() {
  let driver = null;

  let captureUrl;
  let storageUrl;
  let accessUrl;
  let webhookData;
  captureUrl = process.env.URL || (process.argv.length > 2 ? process.argv[2] : null);
  storageUrl = process.env.STORAGE_URL;
  accessUrl = process.env.ACCESS_URL;
  webhookCallbacks = JSON.parse(he.unescape(process.env.WEBHOOK_DATA || "[]"))

  if (process.env.EMBEDS) {
    driver = new EmbedDriver(captureUrl, storageUrl, accessUrl, webhookCallbacks);
  } else {
    driver = new Driver(captureUrl, storageUrl, accessUrl, webhookCallbacks);
  }

  driver.run();
}


main();
