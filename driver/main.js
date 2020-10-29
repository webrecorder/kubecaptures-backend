const { Driver } = require("./driver");
const { EmbedDriver } = require("./embedsdriver");
const he = require("he");


// ================================================================================================
async function main() {
  let driver = null;

  let captureUrl;
  let storageUrl;
  let webhookData;
  captureUrl = process.env.URL || (process.argv.length > 2 ? process.argv[2] : null);
  storageUrl = process.env.STORAGE_URL;
  webhookCallbacks = JSON.parse(he.unescape(process.env.WEBHOOK_DATA || "[]"))

  if (process.env.EMBEDS) {
    driver = new EmbedDriver(captureUrl, storageUrl, webhookCallbacks);
  } else {
    driver = new Driver(captureUrl, storageUrl, webhookCallbacks);
  }

  driver.run();
}


main();
