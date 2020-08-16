"use strict";

const utils = require('./utils.js');

const express = require('express');
const fetch = require('node-fetch');
const app = express();
const querystring = require('querystring');
const fs = require('fs');

const AWS = require('aws-sdk');

const puppeteer = require('puppeteer-core');
const dns = require('dns').promises;

const ARCHIVE_FILE = '/webarchive/collections/capture/archive/archive.warc.gz';

const embedPort = Number(process.env.EMBED_PORT || 3000);
const embedHost = process.env.EMBED_HOST || 'localhost';

const browserHost = process.env.BROWSER_HOST || 'localhost';
const captureUrl = process.env.CAPTURE_URL || (process.argv.length > 2 ? process.argv[2] : null);
const proxyHost = process.env.PROXY_HOST;

const useFreezeDry = false;

let done = false;
let embedWidth = null;
let embedHeight = null;
let embedType = null;

let embedUrl = null;

let currentSize = 0;
let pendingSize = 0;
let statusText = "";
let errored = null;

let oembedMap = {};
let oembedCache = {};

const OUTPUT_FILE = "/tmp/out/archive.wacz";

async function initOembeds() {
  let data = await fs.promises.readFile('./embeds.json', {encoding: 'utf8'});
  oembedMap = JSON.parse(data).embeds;

  for (let r of oembedMap) {
    r.rx = new RegExp(r.rx);
  }
}

function findOembedRule(url) {
  for (let r of oembedMap) {
    if (r.rx.exec(url)) {
      return r;
    }
  }
  return null;
}

function ruleToUrl(rule, url) {
  let params = rule.params || {};
  params.url = url;
  return rule.oe + "?" + querystring.stringify(params);
}

async function getOembed(url) {
  const rule = findOembedRule(url);

  if (!rule) {
    return null;
  }

  if (oembedCache[url]) {
    return oembedCache[url];
  }

  let res = await fetch(ruleToUrl(rule, url));

  if (res.status != 200) {
    return null;
  }

  res = await res.json();

  oembedCache[url] = res;
  embedWidth = res.width;
  embedHeight = res.height;
  embedType = rule.name;

  return res;
}

app.get('/finish', async(req, res) => {
  if (!done) {
    res.sendStatus(404);
    res.json({"error": "not_finished"});
  }

  try {
    return;
  } catch (e) {
    console.log(e);
  }


});

app.get('/exit', async(req, res) => {
  res.json({"exit": 0});
  setTimeout(() => process.exit(0), 1000);
});

app.get('/screenshot', (req, res) => {
  res.sendFile('/tmp/screenshot.png');
});


app.get('/status', (req, res) => {
  res.json({'done': done,
            'error': errored,
            'status': statusText,
            'width': embedWidth,
            'height': embedHeight,
            'type': embedType,
            'size': currentSize + pendingSize});
});

app.get(/info\/(.*)/, async (req, res) => {
  const url = req.originalUrl.slice('/info/'.length);
  const rule = findOembedRule(url);

  if (!rule) {
    res.sendStatus(404);
    return;
  }

  res.redirect(307, ruleToUrl(rule, url));
});

app.get(/e\/(.*)/, async (req, res) => {
  const url = req.originalUrl.slice('/e/'.length);
  const oembed = await getOembed(url);

  if (!oembed || !oembed.html) {
    res.sendStatus(404);
    return;
  }

  let style = "";

  if (embedWidth) {
    style += `width: ${embedWidth}px;`;
  }
  if (embedHeight) {
    style += `height: ${embedHeight}px;`;
  }

  const content = `<div id="embedArchiveDiv" style="${style}">${oembed.html}</div>`;

  res.set('Content-Type', 'text/html');
  res.send(content);
});


async function runDriver() {
  await initOembeds();

  if (!captureUrl) {
    return;
  }

  setStatus("Loading Browser...");

  const { address: hostname } = await dns.lookup(browserHost);

  let browser = null;

  if (!process.env.BROWSER_HOST) {
    browser = await puppeteer.launch({headless: false, defaultViewport: null, executablePath: process.env.EXE_PATH,
                                      args: ['--disable-features=site-per-process']});
  }

  while (!browser) {
    try {
      const oembed = await getOembed(captureUrl);
      //const viewport = {'width': oembed.width || 600, 'height': 600};
      const viewport = null;
      browser = await puppeteer.connect({'browserURL': `http://${hostname}:9222`, 'defaultViewport': viewport});
    } catch (e) {
      console.log(e);
      console.log('Waiting for browser...');
      await utils.sleep(500);
    }
  }

  const pages = await browser.pages();

  const page = pages.length ? pages[0] : await browser.newPage();

  const embedPrefix = (embedPort === 80 ? `http://${embedHost}` : `http://${embedHost}:${embedPort}`);

  setStatus("Getting Embed Info...");

  //try {
  //  await page.goto(`${embedPrefix}/info/${url}`);
  //} catch (e) {
    //console.log(e);
  //}

  if (proxyHost) {
    const captureRes = await fetch(`http:\/\/${proxyHost}:8080/capture/record/mp_/${embedPrefix}/info/${captureUrl}`);

    if (captureRes.status != 200) {
      errored = 'invalid_embed';
      return;
    }
  }

  embedUrl = `${embedPrefix}/e/${captureUrl}`;

  setStatus("Loading Embed...");

  await page.goto(embedUrl, {'waitUntil': 'networkidle0'});

  //startSizeTrack();

  await utils.sleep(100);
  //const computeWidth = await page.evaluate(() => document.querySelector("body").firstElementChild.scrollWidth);

  setStatus("Running Behavior...");

  try {
    await runBehavior(page, captureUrl);
  } catch (e) {
    console.warn(e);
  }

  setStatus("Finishing Capture...");

  if (proxyHost) {
    await waitFileDone(`http://${proxyHost}:8080/api/pending`);
  }

  await commitWacz();

  done = true;
  console.log('done');
  setStatus("Done!");

  process.exit(0);
}

function setStatus(text) {
  statusText = text;
  console.log(statusText);
}

async function startSizeTrack() {
  while (!done) {
    try {
      const { size } = await fs.promises.stat(ARCHIVE_FILE);

      await utils.sleep(500);

      currentSize = size;
    } catch (e) {
      //console.log(e);
      await utils.sleep(500);
    }
  }
}

async function commitWacz() {
  const usp = new URLSearchParams();
  usp.set("url", captureUrl);

  console.log("Requesting WACZ");
  const resp = await fetch(`http://${proxyHost}:8080/api/wacz/capture?${usp.toString()}`);

  if (resp.status !== 200) {
    console.log("error", await resp.text());
    return;
  }

  try {
    const res = await uploadFile();
    console.log(res);
  } catch (err) {
    console.log(err);
  }
}

function uploadFile() {
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

  const uu = new URL(process.env.AWS_UPLOAD_PREFIX + process.env.UPLOAD_FILENAME);

  var params = {
      Body: fs.createReadStream(OUTPUT_FILE),
      Bucket: uu.hostname,
      Key: uu.pathname.slice(1),
      ACL: 'public-read'
  };

  console.log("Uploading WACZ", params);

  return new Promise((resolve, reject) => {
    s3.putObject(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}



async function waitFileDone(pendingCheckUrl) {
  while (true) {
    const oldCurrentSize = currentSize;

    let res = await fetch(pendingCheckUrl);
    res = await res.json();

    const oldPending = res.count;
    pendingSize = res.size;

    await utils.sleep(1000);

    res = await fetch(pendingCheckUrl);
    res = await res.json();

    const newPending = res.count;
    const newPendingSize = res.size;

    if (oldPending <= 0 && newPending <= 0 && newPendingSize === pendingSize && oldCurrentSize === currentSize) {
      return true;
    }

    //console.log(newPendingSize);
  }
}

async function takeCustomCapture(page, handle) {
    setStatus("Taking Screenshot...");

    try {
      if (!handle) {
        //handle = await page.evaluateHandle('document.body.firstElementChild');
      }

      handle = await page.$("#embedArchiveDiv");

      const embedBounds = await handle.boundingBox();

      await page.screenshot({'path': '/tmp/screenshot.png', clip: embedBounds, omitBackground: true});

      const buff = await fs.promises.readFile('/tmp/screenshot.png');

      await putCustomRecord('screenshot:' + embedUrl, 'image/png', buff);
    } catch (e) {
      console.warn(e);
    }

    if (!useFreezeDry) {
      return;
    }

    setStatus("Load Static Snapshot");

    try {
      const inject = await page.addScriptTag({path: './freeze-dry.js'});

      const html = await page.evaluate('freezeDry.default()');

      await fs.promises.writeFile('/tmp/snapshot.html', html);

      await putCustomRecord('dom:' + embedUrl, 'text/html', html);
    } catch (e) {
      console.warn(e);
    }
}


async function putCustomRecord(url, contentType, buff) {
  try {
    if (!proxyHost) {
      return;
    }

    const putUrl = `http:\/\/${proxyHost}:8080/api/custom/capture?${querystring.stringify({"url": url})}`;

    let res = await fetch(putUrl, { method: 'PUT', body: buff, headers: { 'Content-Type': contentType } });
    res = await res.json();
    console.log(res);
  } catch (e)  {
    console.log(e);
  }
}


async function runBehavior(page, url) {
  const rule = findOembedRule(url);

  if (!rule) {
    console.log('no rule for: ' + url);
    return false;
  }

  let func = null;

  switch (rule.name) {
    case "tweet":
      await runTweet(page);
      break;

    case "instagram":
      await runIG(page);
      break;

    case "youtube":
      await runYT(page);
      break;

    case "facebook":
      await runFB(page);
      break;

    case "facebook_video":
      await runFBVideo(page);
  }

  await utils.waitForNet(page, 5000);

  return true;
}

   






async function runTweet(page) {
  const selector = 'div[data-scribe="element:play_button"]';

  await takeCustomCapture(page);

  const res = await page.evaluate(utils.clickShadowRoot, 'twitter-widget', selector);
  if (res){
    setStatus('Loading Video...');
  }
  return res;
}

async function runIG(page) {
  const frame = await utils.waitForFrame(page, 1);
  if (!frame) {
    console.log('no frame?');
    return false;
  }

  const liList = await frame.$$('ul > li', {timeout: 500});

  await takeCustomCapture(page);

  if (liList && liList.length) {
    let first = true;

    for (let child of liList) {
      if (!first) {
        setStatus('Loading Slides...');
        await utils.waitForClick(frame, "div.coreSpriteRightChevron", 500);
        await utils.sleep(1000);
      }
      first = false;

      const video = await child.$('video');

      if (video) {
        setStatus('Loading Video...');
        await video.click();
        await utils.sleep(1000);
      }
    }

    return false;

  } else {
    const videos = await frame.$$('video');

    for (let video of videos) {
      try {
        setStatus('Loading Video...');
        await video.click();
        await utils.sleep(1000);
      } catch (e) {
        console.log(e);
      }
    }

    return true;
  }
}

async function runYT(page) {
  const frame = await utils.waitForFrame(page, 1);
  if (!frame) {
    console.log('no frame found?');
    return false;
  }

  try {
    const selector = 'button[aria-label="Play"]';
    await frame.waitForSelector(selector, {timeout: 10000});
    await utils.sleep(500);
    await takeCustomCapture(page);
    setStatus('Loading Video...');
    await frame.click(selector);

  } catch (e) {
    console.log(e);
    console.log('no play button!');
  }
    
  return true;
}

async function runFB(page) {
  const frame = await utils.waitForFrame(page, 2);

  //await utils.sleep(500);
  await frame.waitForSelector('[aria-label]');
  const handle = await page.waitForSelector('div.fb-post');

  await takeCustomCapture(page, handle);

  await utils.sleep(1000);

  return true;
}

async function runFBVideo(page) {
  const frame = await utils.waitForFrame(page, 2);

  //await utils.sleep(500);
  await frame.waitForSelector('[aria-label]');
  const handle = await page.waitForSelector('div.fb-video');
  await takeCustomCapture(page, handle);
 
  setStatus('Playing Video...');
  await utils.waitForClick(frame, "input[type=button][aria-label]", 1000);

  await utils.sleep(1000);

  return true;
}


runDriver();

app.listen(embedPort);


