
const fs = require("fs");
const dns = require("dns").promises;

const AWS = require("aws-sdk");
const fetch = require("node-fetch");

const puppeteer = require("puppeteer-core");

const OUTPUT_FILE = "/tmp/out/archive.wacz";

const utils = require("./utils");
const setStatus = utils.setStatus;


// ================================================================================================
class Driver
{
  constructor() {
    this.browserHost = process.env.BROWSER_HOST || "localhost";
    this.captureUrl = process.env.CAPTURE_URL || (process.argv.length > 2 ? process.argv[2] : null);
    this.proxyHost = process.env.PROXY_HOST;
    this.proxyPort = process.env.PROXY_PORT || 8080;
    this.proxyOrigin = `http://${this.proxyHost}:${this.proxyPort}`;

    this.done = false;

    this.currentSize = 0;
    this.pendingSize = 0;
    this.statusText = "";
    this.errored = null;

    this.entryUrl = null;
  }

  async run() {
    if (!await this.initBrowser()) {
      return;
    }

    await this.runCapture(this.page);

    await this.finish();
  }

  async initBrowser() {
    if (!this.captureUrl) {
      setStatus("No URL, exiting...");
      return false;
    }
  
    setStatus("Loading Browser...");
  
    const { address: hostname } = await dns.lookup(this.browserHost);
  
    let browser = null;
  
    if (!process.env.BROWSER_HOST) {
      browser = await puppeteer.launch({headless: false, defaultViewport: null, executablePath: process.env.EXE_PATH,
        args: ["--disable-features=site-per-process"]});
    }

    const defaultViewport = this.getDefaultViewport();
    const browserURL = `http://${hostname}:9222`;
  
    while (!browser) {
      try {
        browser = await puppeteer.connect({browserURL, defaultViewport});
      } catch (e) {
        console.log(e);
        console.log("Waiting for browser...");
        await utils.sleep(500);
      }
    }

    this.browser = browser;

    const pages = await browser.pages();

    this.page = pages.length ? pages[0] : await browser.newPage();

    return true;
  }

  async runCapture(page) {
    if (process.env.DISABLE_CACHE) {
      setStatus(`Disabling Cache`);

      await page.setCacheEnabled(false);
      await page._client.send('Network.setBypassServiceWorker', {bypass: true});
    }

    setStatus(`Loading Page: ${this.captureUrl}`);

    try {
      await page.goto(this.captureUrl, {"waitUntil": "networkidle0", "timeout": 60000});
    } catch (e) {
      console.log(e);
    }

    this.entryUrl = this.captureUrl;
  
    await utils.sleep(100);
  }

  async exitBrowser() {
    if (process.env.EXIT_FILE) {
      console.log("Creating exit file: " + process.env.EXIT_FILE);
      fs.closeSync(fs.openSync(process.env.EXIT_FILE, "w"));
    }
    
    try {
      console.log("Closing Browser...");
      await this.browser.close();

    } catch (e) {
      console.log(e);
    }
  }

  async finish() {
    await this.exitBrowser();

    setStatus("Finishing Capture...");

    if (this.proxyHost) {
      await Promise.race([this.waitFileDone(`${this.proxyOrigin}/api/pending`), utils.sleep(15000)])
    }

    const res = await this.commitWacz(this.entryUrl || this.captureUrl);

    try {
      await fetch(`${this.proxyOrigin}/api/exit`);
    } catch (e) {
      console.log(e);
    }

    this.done = true;
    setStatus("Done!");

    process.exit(res);
  }

  getDefaultViewport() {
    return null;
  }
  
  async commitWacz(url) {
    const usp = new URLSearchParams();
    usp.set("url", url);
  
    setStatus("Requesting WACZ");
    const resp = await fetch(`${this.proxyOrigin}/api/wacz/capture?${usp.toString()}`);
  
    if (resp.status !== 200) {
      console.log("error", await resp.text());
      return;
    }
  
    try {
      const res = await this.uploadFile();
      console.log(res);
      return 0;
    } catch (err) {
      console.log(err);
      return 1;
    }
  }
  
  uploadFile() {
    const accessKeyId =  process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  
    // Configure client for use with Spaces
    let endpoint = null;
  
    if (process.env.AWS_ENDPOINT) {
      endpoint = new AWS.Endpoint(process.env.AWS_ENDPOINT);
    }
  
    const s3 = new AWS.S3({
      endpoint,
      accessKeyId,
      secretAccessKey
    });
  
    const uu = new URL(process.env.STORAGE_PREFIX + process.env.UPLOAD_FILENAME);
  
    var params = {
      Body: fs.createReadStream(OUTPUT_FILE),
      Bucket: uu.hostname,
      Key: uu.pathname.slice(1),
      ACL: "public-read"
    };
  
    setStatus("Uploading WACZ: " + OUTPUT_FILE);
  
    return new Promise((resolve, reject) => {
      s3.putObject(params, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  async waitFileDone(pendingCheckUrl) {
    while (true) {
      //const oldCurrentSize = this.currentSize;
  
      let res = await fetch(pendingCheckUrl);
      res = await res.json();

      console.log(`Pending: ${JSON.stringify(res)}`);
  
      const oldPending = res.count;
      this.pendingSize = res.size;
  
      await utils.sleep(1000);
  
      res = await fetch(pendingCheckUrl);
      res = await res.json();
  
      const newPending = res.count;
      const newPendingSize = res.size;
  
      if (oldPending <= 0 && newPending <= 0 && newPendingSize === this.pendingSize) {
        return true;
      }

      if (oldPending == newPending && this.pendingSize == newPendingSize && newPending <= 2) {
        return true;
      }
    }
  }
}

module.exports = { Driver };
