const { Driver } = require("./driver");
const { EmbedDriver } = require("./embedsdriver");

// ================================================================================================
let driver = null;

if (process.env.EMBEDS) {
  driver = new EmbedDriver();
} else {
  driver = new Driver();
}

driver.run();

