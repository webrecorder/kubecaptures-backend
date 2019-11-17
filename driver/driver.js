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
}
];

const ARCHIVE_DIR = '/webarchive/collections/capture/archive/';

let done = false;

function findOembedRule(url) {
  for (let r of oembedMap) {
    if (r.rx.exec(url)) {
      return r;
    }
  }
  return null;
}

async function getOembed(url) {
  const rule = findOembedRule(url);

  if (!rule) {
    return null;
  }

  let res = await fetch(rule.oe + "?" + querystring.stringify({"url": url}));
  res = await res.json();

  return res.html;
}


async function getWarcFile() {
  try {
    const files = await fs.promises.readdir(ARCHIVE_DIR);
    if (files.length) {
      return ARCHIVE_DIR + files[0];
    }
  } catch (e) {}

  return null;
}
 

app.get('/download', async(req, res) => {
  if (done) {
    const file = await getWarcFile();
    if (file) {
      res.sendFile(file);
      return;
    }
  }

  res.sendStatus(404);
  res.send('Not Found');
});


app.get('/done', (req, res) => {
  res.json({'done': done});
});


app.get(/embed\/(.*)/, async (req, res) => {
  const url = req.originalUrl.slice('/embed/'.length);
  const content = await getOembed(url);

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

  

  if (!url) {
    return;
  }

  const { address: hostname } = await dns.lookup(browserHost);

  let browser = null;

  while (!browser) {
    try {
      browser = await puppeteer.connect({'browserURL': `http://${hostname}:9222`, 'defaultViewport': null});
    } catch (e) {
      console.log('Waiting for browser...');
      await sleep(500);
    }
  }

  const pages = await browser.pages();
  const page = pages[0];

  if (page.url() !== 'about:blank') {
    await page.goto('about:blank');
  }

  await page.goto(`http://${embedHost}:3000/embed/` + url, {'waitUntil': 'networkidle0'});

  await runBehavior(page, url);

  //await sleep(500);

  const filename = await getWarcFile();

  await waitFileDone(filename);

  done = true;
  console.log('done');
}


async function runBehavior(page, url) {
  const rule = findOembedRule(url);

  if (!rule) {
    console.log('no rule for: ' + url);
    return false;
  }

  let toWait = false;
  let func = null;

  switch (rule.name) {
    case "tweet":
      toWait = await runTweet(page);
      break;

    case "instagram":
      toWait = await runIG(page);
      break
  }

  console.log(`to wait: ${toWait}`);

  if (toWait) {
    await waitForNet(page, 2000);
  }

  return true;
}

   


async function waitForNet(page, idle) {
  //const client = await page.target().createCDPSession();

  const client = page._client;
  let resolve = null;
  const p = new Promise((r) => resolve = r);

  let tid = null;

  client.send('Network.enable');
  client.on('Network.loadingFinished', restartTimer);

  const networkManager = page._frameManager.networkManager();

  function restartTimer() {
    if (tid) { clearTimeout(tid); }
    tid = setTimeout(() => { 
      resolve();
      clearTimeout(tid);
    }, idle); 
  };

  restartTimer();
  return p;
}


function clickShadowRoot(shadowTarget, target) {
  const widget = document.querySelector(shadowTarget);

  if (!widget || !widget.shadowRoot) {
    return false;
  }

  const shadowObj = widget.shadowRoot.querySelector(target);

  if (shadowObj) {
    shadowObj.click();
    return true;
  }

  return false;
}

async function runTweet(page) {
  const selector = 'div[data-scribe="element:play_button"]';

  return await page.evaluate(clickShadowRoot, 'twitter-widget', selector);
}

async function runIG(page) {
  if (!await waitFor(3000, () => { console.log(page.frames().length); return page.frames().length > 1 })) {
    return false;
  }

  const frame = page.frames()[1];

  const videos = await frame.$$('video');

  if (!videos || !videos.length) {
    return false;
  }

  for (let video of videos) {
    try {
      await video.click();
    } catch (e) {
      console.log(e);
    }
  }

  return true;
}


async function waitFileDone(filename) {
  if (!filename) return;

  while (true) {
    const { size } = await fs.promises.stat(filename);

    await sleep(500);

    const stats = await fs.promises.stat(filename);

    if (size === stats.size) {
      return true;
    }

    await sleep(500);
  }
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(ms, predicate) {
  const startTime = new Date().getTime();

  while (true) {
    if (predicate()) {
      return true;
    }

    await sleep(500);

    if ((new Date().getTime() - startTime) >= ms) {
      return false;
    }
  }
}




runDriver();

app.listen(3000)


