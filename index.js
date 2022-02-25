const puppeteer = require("puppeteer");
const moment = require("moment");
const fs = require("fs");
const notifier = require("node-notifier");

const tipsters = require("./tipsters.json");

const browserOptions = {
  userDataDir: "./userDataDir",
  headless: false,
  defaultViewport: null,
  ignoreHTTPSErrors: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--window-size=1920,1080",
    "--window-position=1921,0",
  ],
};

const baseURL = "https://www.protipster.com";
const username = "irwsch";

(async function run() {
  const browser = await puppeteer.launch(browserOptions);
  const page = (await browser.pages())[0];
  const ownActiveTips = (await getTipsterTips(page, { username }, true)) || [];

  let tipstersActiveTips = [];

  for (const tipster of tipsters) {
    const tipsterTips = (await getTipsterTips(page, tipster)) || [];

    if (Array.isArray(tipsterTips)) {
      tipstersActiveTips = [...tipstersActiveTips, ...tipsterTips];
    }
  }

  const missingTips = getMissingTips(ownActiveTips, tipstersActiveTips);
  const sortedMissingTips = sortTipsByDate(missingTips);

  printSummary(tipstersActiveTips, sortedMissingTips);
  notifyMissingTips(sortedMissingTips);
  await saveTips(ownActiveTips, tipstersActiveTips, sortedMissingTips);

  await browser.close();
  setTimeout(run, 120 * 1000);
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
  let nextPageNumber = 2;

  while (true) {
    const pageActiveTips = await getPageActiveTips(page, tipster);

    tipsterActiveTips = tipsterActiveTips.concat(pageActiveTips);

    if (await isActiveTipsLastPage(page)) {
      break;
    }

    await page.goto(`${tipsterTipsURL}/${nextPageNumber}`, {
      waitUntil: "load",
    });
    await page.waitForTimeout(1000);

    nextPageNumber += 1;
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
  return await page.$eval(".tipster-picks", ({ innerText }) => innerText.includes("Settled Tips"));
}

function printTipsterTips(tipster, tipsterActiveTips, isOwnTips) {
  if (isOwnTips) {
    console.log(`You have ${tipsterActiveTips.length} active and valid tips.\n`);
    return;
  }

  console.log(`User ${tipster.username} has ${tipsterActiveTips.length} active and valid tips.`);
}

function printSummary(tipstersActiveTips, sortedMissingTips) {
  console.log(`\nThere are ${tipstersActiveTips.length} tips.`);
  console.log(`There are ${sortedMissingTips.length} missing for you.\n`);
}

function sortTipsByDate(activeTips) {
  return activeTips.sort((a, b) => {
    const tempDateA =
      a.time === "Live Now" ? moment().toDate() : moment(a.time, "DD-MM-YYYY HH:mm").toDate();

    const tempDateB =
      b.time === "Live Now" ? moment().toDate() : moment(b.time, "DD-MM-YYYY HH:mm").toDate();

    return tempDateA - tempDateB;
  });
}

async function getPageActiveTips(page, tipster) {
  return await page.$$eval(
    ".card.tip-details",
    async (elements, tipster) => {
      const tempPageActiveTips = [];

      // TODO Add only tips without block symbol
      elements.forEach(async (tipElement) => {
        const isInvalidTip = tipElement.querySelector(
          "[data-original-title='Too late, this tip is no longer valid. You cannot add it to your coupon.']"
        );

        if (isInvalidTip) {
          return;
        }

        const selectors = {
          match: () => {
            const selector = ".w-full:nth-of-type(2) > div:nth-of-type(1)";
            return tipElement.querySelector(selector).innerText.trim();
          },

          sport: () => {
            const selector = ".w-full:nth-of-type(2) > div:nth-of-type(2) > a";
            return tipElement.querySelector(selector).innerText.trim();
          },

          time: () => {
            const selector = ".w-full:nth-of-type(2) > div:nth-of-type(2) > :first-child";
            return tipElement.querySelector(selector).innerText.trim();
          },

          bet: () => {
            const selector = ".w-full:nth-of-type(3) > p";
            return tipElement.querySelector(selector).innerText.trim();
          },

          odd: () => {
            const selector = ".w-full:nth-of-type(3) span";
            return parseFloat(tipElement.querySelector(selector).innerText.trim().split(" ")[1]);
          },

          // stake: async () => {
          //   await tipElement.querySelector(".w-full:nth-of-type(4) div").click();
          //   await page.waitForTimeout(3000);

          //   const selector = ".z-9999 .tracking-widest";
          //   return parseInt(document.querySelector(selector).innerText.split(" ")[5]);
          // },

          protipsterLink: () => {
            const selector = ".w-full:nth-of-type(2) > div:nth-of-type(1) > a";
            return tipElement.querySelector(selector).href;
          },

          betLink: async () => {
            await tipElement
              .querySelector(".w-full:nth-of-type(4) > .tip-betting > div > div")
              .click();

            await tipElement.querySelector("div > div > [data-bookie='1xBet']").click();

            return tipElement.querySelector(".w-full:nth-of-type(4) > .tip-betting a").href;
          },
        };

        const data = {
          user: tipster.username,
        };

        for (const [key, callback] of Object.entries(selectors)) {
          data[key] = await callback();
        }

        console.log(data);

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

function getMissingTips(ownActiveTips, tipstersTips) {
  let uniqueTipstersTips = [];

  tipstersTips.forEach((tip) => {
    const alreadyAddedTipIndex = uniqueTipstersTips.findIndex(
      ({ match, bet }) => match === tip.match && bet === tip.bet
    );

    // Tip não existe
    if (alreadyAddedTipIndex === -1) {
      uniqueTipstersTips.push({ ...tip, user: [tip.user] });

      return;
    }

    // Tip já existe
    const alreadyAddedTipsterTip = uniqueTipstersTips[alreadyAddedTipIndex].user.includes(tip.user);

    // User já existe na tip
    if (alreadyAddedTipsterTip) {
      return;
    }

    // User não existe na tip
    uniqueTipstersTips[alreadyAddedTipIndex].user.push(tip.user);
  });

  return uniqueTipstersTips.filter(
    (tip) => !ownActiveTips.some((ownTip) => ownTip.match === tip.match && ownTip.bet === tip.bet)
  );
}

function notifyMissingTips(missingTips) {
  if (missingTips.length === 0) {
    return;
  }

  notifier.notify({
    title: "Missing tips",
    message: `There are ${missingTips.length} missing tips.`,
    sound: true, // Only Notification Center or Windows Toasters
    wait: true, // Wait with callback, until user action is taken against notification, does not apply to Windows Toasters as they always wait or notify-send as it does not support the wait option
  });
}

async function saveTips(ownActiveTips, tipstersActiveTips, sortedMissingTips) {
  await saveToJSON("tips/own.json", ownActiveTips);
  await saveToJSON("tips/tipsters.json", tipstersActiveTips);
  await saveToJSON("tips/missing.json", sortedMissingTips);
}

async function saveToJSON(fileName, tips) {
  fs.writeFile(fileName, JSON.stringify(tips), (error) => {
    if (error) {
      console.log(error);
    }
  });
}
