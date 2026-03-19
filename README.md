# TCGPlayer Cart Optimizer

I got tired of the suboptimal TCGPlayer optimizer so wrote this to find true the true optimal for carts using [HiGHS](https://en.wikipedia.org/wiki/HiGHS_optimization_solve). 

In my testing, it's performed much better than the TCGPLayer optimizer, saving me ~25% more usually.

The optimizer currently only supports finding the cheapest option. Maybe later I'll add support for fewest packages optimization.

## How It Works

There are two components:
- a CLI which takes in JSON representing the state of your cart, finds the optimal solution, and outputs JSON representing that optimal solution
- a chrome extension which helps extract the JSON representing your cart and which helps apply the optimal state from the cli

The extension adds an overlay to the page which has an outline of the steps which you'll need to go through:

![UI](public/ui.png)

1. **Export** — The extension reads your cart and fetches all available seller listings for each item, then downloads a JSON file.
2. **Solve** — You run the solver locally via the CLI to compute the cheapest combination of sellers.
3. **Import & Apply** — You paste or drag-drop the solver output back into the extension, review the changes, and apply them to your cart.

## Setup

### Prerequisites

- Node.js
- Chromium browser (Google Chrome, Brave, etc)

### Install Dependencies

```sh
npm install
```

### Build the Extension

```sh
npm run build
```

### Load the Extension in Chrome

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `dist/` folder from this project.

## Usage

1. Go to [tcgplayer.com](https://www.tcgplayer.com) and add cards to your cart.
2. Navigate to your cart page — the optimizer overlay will appear on the right side.
3. Follow the steps.
   1. **Export:** Click **Download Cart Export** to save the cart data as a JSON file.
   2. **Solve:** Run the solver locally: `npm run solve -- --input <export.json> --output <result.json>`
   3. **Import:** Back in the extension overlay, paste the solver output JSON or drag-drop the file. Review the proposed changes (old vs. new sellers and prices), then click **Apply Changes** to update your cart.

