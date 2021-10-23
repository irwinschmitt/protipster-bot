const puppeteer = require("puppeteer");
const fs = require("fs");

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

(async function () {
  const browser = await puppeteer.launch(browserOptions);
  const page = await browser.newPage();
  let activeTips = [];

  for (const tipster of tipsters) {
    const tipsterTipsURL = `${baseURL}/tipster/${tipster.username}/tips`;
    await page.goto(tipsterTipsURL);
    await page.waitForTimeout(2000);

    const { hasActiveTips, isLastPage } = await page.$eval(
      ".tipster-picks",
      ({ innerText }) => ({
        hasActiveTips: innerText.includes("Active Tips"),
        isLastPage: innerText.includes("Settled Tips"),
      })
    );

    if (!hasActiveTips) {
      continue;
    }

    let userActiveTips = [];

    while (true) {
      const pageActiveTips = await page.$$eval(
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

            const data = {};

            for (const [key, value] of Object.entries(selectors)) {
              data[key] = tipElement.querySelector(value).innerText.trim();
            }

            // TODO Empty sports to get all
            if (!tipster.sports.includes(data.sport)) {
              return;
            }

            tempPageActiveTips.push(data);
          });

          return tempPageActiveTips;
        },
        tipster
      );

      userActiveTips = userActiveTips.concat(pageActiveTips);

      if (isLastPage) {
        break;
      }

      // TODO go to next page
      break;
    }

    activeTips = activeTips.concat(userActiveTips);

    console.log(
      "User: ",
      tipster.username,
      " has ",
      userActiveTips.length,
      " active tips."
    );
  }

  console.log("total tips: ", activeTips.length);

  fs.writeFile("bets.json", JSON.stringify(activeTips), (error) => {
    if (error) {
      console.log(error);
    }
  });

  await browser.close();
})();
