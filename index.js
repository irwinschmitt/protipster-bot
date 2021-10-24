const puppeteer = require("puppeteer");
const moment = require("moment");
const fs = require("fs");
const notifier = require("node-notifier");

const tipsters = require("./tipsters.json");

const browserOptions = {
  headless: false,
  defaultViewport: null,
  ignoreHTTPSErrors: true,
  args: [
    "--disable-setuid-sandbox",
    "--window-size=960,1080",
    "--window-position=961,0",
  ],
};

const baseURL = "https://www.protipster.com";

(async function run() {
  const browser = await puppeteer.launch(browserOptions);
  const page = await browser.newPage();

  ownActiveTips = await getTipsterTips(page, { username: "irwsch" }, true);

  let tipstersActiveTips = [];

  for (const tipster of tipsters) {
    const tipsterTips = await getTipsterTips(page, tipster);

    if (Array.isArray(tipsterTips)) {
      tipstersActiveTips = [...tipstersActiveTips, ...tipsterTips];
    }
  }

  const missingTips = await getMissingTips(ownActiveTips, tipstersActiveTips);

  console.log(`\nTipsters have ${tipstersActiveTips.length} active tips.\n`);
  console.log(`There are ${missingTips.length} missing for you.\n`);
  console.log("=========\n");

  if (missingTips.length > 0) {
    notifyMissingTips(missingTips);
  }

  await saveToJSON("tips/own.json", ownActiveTips);
  await saveToJSON("tips/tipsters.json", tipstersActiveTips);
  await saveToJSON("tips/missing.json", missingTips);

  await browser.close();

  setTimeout(run, 30 * 1000);
})();

async function getTipsterTips(page, tipster, isOwnTips) {
  const tipsterTipsURL = `${baseURL}/tipster/${tipster.username}/tips`;

  await page.goto(tipsterTipsURL, {
    waitUntil: "load",
  });

  if (await isActiveTipsEmpty(page)) {
    return;
  }

  let tipsterActiveTips = [];

  for (let nextPageNumber = 2; nextPageNumber++; ) {
    const pageActiveTips = await getPageActiveTips(page, tipster);
    tipsterActiveTips = [...tipsterActiveTips, ...pageActiveTips];

    if (await isActiveTipsLastPage(page)) {
      break;
    }

    await page.goto(`${tipsterTipsURL}/${nextPageNumber}`, {
      waitUntil: "load",
    });
  }

  printTipsterTips(tipster, tipsterActiveTips, isOwnTips);

  return tipsterActiveTips;
}

async function isActiveTipsEmpty(page) {
  return !(await page.$eval(".tipster-picks", ({ innerText }) =>
    innerText.includes("Active Tips")
  ));
}

async function isActiveTipsLastPage(page) {
  return await page.$eval(".tipster-picks", ({ innerText }) =>
    innerText.includes("Settled Tips")
  );
}

function printTipsterTips(tipster, tipsterActiveTips, isOwnTips) {
  if (isOwnTips) {
    console.log(`You have ${tipsterActiveTips.length} active tips.\n`);
    return;
  }

  console.log(
    `User ${tipster.username} has ${tipsterActiveTips.length} active tips.`
  );
}

function sortTipsByDate(activeTips) {
  return activeTips.sort((a, b) => {
    return (
      moment(a.time, "DD-MM-YYYY HH:mm").toDate() -
      moment(b.time, "DD-MM-YYYY HH:mm").toDate()
    );
  });
}

async function getPageActiveTips(page, tipster) {
  return await page.$$eval(
    ".card.tip-details",
    (elements, tipster) => {
      const tempPageActiveTips = [];

      // TODO Add only tips without block symbol
      elements.forEach((tipElement) => {
        const isTipElementActive = tipElement.querySelector(
          "[data-track='TipSlip,BetNow']"
        );

        if (!isTipElementActive) {
          return;
        }

        const selectors = {
          match: ".w-full:nth-of-type(2) > div:nth-of-type(1)",
          sport: ".w-full:nth-of-type(2) > div:nth-of-type(2) > a",
          time: ".w-full:nth-of-type(2) > div:nth-of-type(2) > time",
          bet: ".w-full:nth-of-type(3) > p",
        };

        const data = {
          user: tipster.username,
        };

        for (const [key, value] of Object.entries(selectors)) {
          data[key] = tipElement.querySelector(value).innerText.trim();
        }

        if (tipster.sports && !tipster.sports.includes(data.sport)) {
          return;
        }

        tempPageActiveTips.push(data);
      });

      return tempPageActiveTips;
    },
    tipster
  );
}

function getMissingTips(ownActiveTips, tipstersActiveTips) {
  return tipstersActiveTips.filter(
    (tipsterTip) =>
      !ownActiveTips.some(
        (ownTip) =>
          ownTip.match === tipsterTip.match && ownTip.bet === tipsterTip.bet
      )
  );
}

function notifyMissingTips(missingTips) {
  notifier.notify({
    title: "Missing tips",
    message: `There are ${missingTips.length} missing tips.`,
    sound: true, // Only Notification Center or Windows Toasters
    wait: true, // Wait with callback, until user action is taken against notification, does not apply to Windows Toasters as they always wait or notify-send as it does not support the wait option
  });
}

async function saveToJSON(fileName, tips) {
  fs.writeFile(fileName, JSON.stringify(tips), (error) => {
    if (error) {
      console.log(error);
    }
  });
}
