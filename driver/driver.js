"use strict";

const utils = require('./utils.js');

const express = require('express');
const fetch = require('node-fetch');
const app = express();
const querystring = require('querystring');
const fs = require('fs');

const puppeteer = require('puppeteer-core');
const dns = require('dns').promises;



const oembedMap = [
{
  "rx": /https?:\/\/twitter.com/,
  "oe": 'https://publish.twitter.com/oembed',
  "name": "tweet"
},

{
  "rx": /https?:\/\/(www\.)?instagram[.]com/,
  "oe": 'https://api.instagram.com/oembed',
  "name": "instagram"
},

{
  "rx": /https?:\/\/(www\.)?youtube[.]com\/watch/,
  "oe": 'http://www.youtube.com/oembed',
  "name": "youtube"
},

{  "rx": /https?:\/\/(www\.)?facebook[.]com/,
   "oe": 'https://www.facebook.com/plugins/post/oembed.json/',
   "name": "facebook"
}

];

const ARCHIVE_FILE = '/webarchive/collections/capture/archive/archive.warc.gz';

const embedPort = Number(process.env.EMBED_PORT || 3000);

let done = false;
let embedWidth = null;
let embedType = null;

let currentSize = 0;
let pendingSize = 0;
let statusText = "";

let oembedCache = {};

function findOembedRule(url) {
  for (let r of oembedMap) {
    if (r.rx.exec(url)) {
      return r;
    }
  }
  return null;
}

function ruleToUrl(rule, url) {
  return rule.oe + "?" + querystring.stringify({"url": url});
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
  res = await res.json();

  oembedCache[url] = res;
  embedWidth = res.width;
  embedType = rule.name;

  return res;
}

app.get('/download', async(req, res) => {
  if (done) {
    try {
      res.sendFile(ARCHIVE_FILE);
      return;
    } catch (e) {
      console.log(e);
    }
  }

  res.sendStatus(404);
  res.send('Not Found');
});

app.get('/screenshot', (req, res) => {
  res.sendFile('/tmp/screenshot.png');
});


app.get('/status', (req, res) => {
  res.json({'done': done, 'status': statusText, 'width': embedWidth, 'type': embedType, 'size': currentSize + pendingSize});
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
  const content = oembed.html;

  res.set('Content-Type', 'text/html');

  if (!content) {
    res.sendStatus(404);
  } else {
    res.send(content);
  }
});


async function runDriver() {
  const browserHost = process.env.BROWSER_HOST || 'localhost';
  const url = process.env.CAPTURE_URL;
  const embedHost = process.env.EMBED_HOST || 'localhost';
  const proxyHost = process.env.PROXY_HOST;

  if (!url) {
    return;
  }

  setStatus("Loading Browser...");

  const { address: hostname } = await dns.lookup(browserHost);

  let browser = null;

  while (!browser) {
    try {
      const oembed = await getOembed(url);
      //const viewport = {'width': oembed.width || 600, 'height': 600};
      const viewport = null;
      browser = await puppeteer.connect({'browserURL': `http://${hostname}:9222`, 'defaultViewport': viewport});
    } catch (e) {
      console.log('Waiting for browser...');
      await utils.sleep(500);
    }
  }

  const pages = await browser.pages();

  const page = pages.length ? pages[0] : await browser.newPage();

  const embedPrefix = (embedPort === 80 ? `http://${embedHost}` : `http://${embedHost}:${embedPort}`);

  setStatus("Getting Embed Info...");

  try {
    await page.goto(`${embedPrefix}/info/${url}`);
  } catch (e) {
    //console.log(e);
  }

  const embedUrl = `${embedPrefix}/e/${url}`;

  setStatus("Loading Embed...");

  await page.goto(embedUrl, {'waitUntil': 'networkidle0'});

  startSizeTrack();

  await utils.sleep(100);
  //const computeWidth = await page.evaluate(() => document.querySelector("body").firstElementChild.scrollWidth);

  const takeScreenshot = async () => {
    setStatus("Taking Screenshot...");

    const embedHandle = await page.evaluateHandle('document.body.firstElementChild');
    const embedBounds = await embedHandle.boundingBox();

    await page.screenshot({'path': '/tmp/screenshot.png', clip: embedBounds, omitBackground: true});

    if (proxyHost) {
      await putScreenshot(`http://${proxyHost}:8080/api/screenshot/capture`, embedUrl, '/tmp/screenshot.png');
    }
  }

  setStatus("Running Behavior...");

  await runBehavior(page, url, takeScreenshot);

  setStatus("Finishing Capture...");

  if (proxyHost) {
    await waitFileDone(`http://${proxyHost}:8080/api/pending`);
  }

  done = true;
  console.log('done');
  setStatus("Done!");
}

function setStatus(text) {
  statusText = text;
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

async function putScreenshot(putUrl, url, filename) {
  try {
    const buff = await fs.promises.readFile(filename);

    //console.log('size: ' + buff.length);

    putUrl += "?" + querystring.stringify({"url": url});

    let res = await fetch(putUrl, { method: 'PUT', body: buff, headers: { 'Content-Type': 'image/png' } });
    res = await res.json();
    console.log(res);
  } catch (e)  {
    console.log(e);
  }
}


async function runBehavior(page, url, takeScreenshot) {
  const rule = findOembedRule(url);

  if (!rule) {
    console.log('no rule for: ' + url);
    return false;
  }

  let toWait = false;
  let func = null;

  switch (rule.name) {
    case "tweet":
      toWait = await runTweet(page, takeScreenshot);
      break;

    case "instagram":
      toWait = await runIG(page, takeScreenshot);
      break;

    case "youtube":
      toWait = await runYT(page, takeScreenshot);
      break;
  }

  console.log(`to wait: ${toWait}`);

  if (toWait) {
    await utils.waitForNet(page, 5000);
  }

  return true;
}

   






async function runTweet(page, takeScreenshot) {
  const selector = 'div[data-scribe="element:play_button"]';

  await takeScreenshot();

  const res = await page.evaluate(utils.clickShadowRoot, 'twitter-widget', selector);
  if (res){
    setStatus('Playing video...');
  }
  return res;
}

async function runIG(page, takeScreenshot) {
  const frame = await utils.waitForFrame(page, 1);
  if (!frame) {
    return false;
  }

  const liList = await frame.$$('ul > li', {timeout: 500});

  await takeScreenshot();

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

async function runYT(page, takeScreenshot) {
  const frame = await utils.waitForFrame(page, 1);
  if (!frame) {
    console.log('no frame found?');
    return false;
  }

  try {
    const selector = 'button[aria-label="Play"]';
    await frame.waitForSelector(selector, {timeout: 10000});
    await utils.sleep(500);
    await takeScreenshot();
    setStatus('Loading Video...');
    await frame.click(selector);

  } catch (e) {
    console.log(e);
    console.log('no play button!');
  }
    
  return true;
}


runDriver();

app.listen(embedPort);


