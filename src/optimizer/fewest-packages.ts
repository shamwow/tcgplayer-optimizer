import type { ModelInput, SolverResult } from "./types";

type BitMask = number[];

interface SellerOption {
  cardIndex: number;
  priceCents: number;
  listingId: string;
}

interface SellerNode {
  sellerKey: string;
  shippingCents: number;
  options: SellerOption[];
  optionByCard: Map<number, SellerOption>;
  coverageMask: BitMask;
}

interface ComponentProblem {
  globalCardIndices: number[];
  sellers: SellerNode[];
}

interface SelectionState {
  coverageMask: BitMask;
  bestPrices: number[];
  bestListings: string[];
  shippingCents: number;
  totalCostCents: number;
  activeSellerKeys: string[];
}

interface ComponentSolution {
  activeSellerKeys: string[];
  bestListings: string[];
  totalCostCents: number;
}

const INF = Number.POSITIVE_INFINITY;
const MAX_STATE_CACHE = 1_000_000;

export function solveFewestPackagesExact(
  input: ModelInput,
  startTime: number
): SolverResult {
  const sellers = collapseListingsToSellers(input);
  const components = splitIntoComponents(input.cards.length, sellers);

  console.log(
    `[Solver] Fewest-packages seller search: ${input.cards.length} cards, ${sellers.length} sellers, ${components.length} components`
  );

  const chosenListings = new Map<number, string>();
  const activeSellers = new Set<string>();
  let objectiveValue = 0;

  for (const component of components) {
    const result = solveComponent(component);
    objectiveValue += result.totalCostCents;

    for (let localCardIndex = 0; localCardIndex < component.globalCardIndices.length; localCardIndex++) {
      chosenListings.set(component.globalCardIndices[localCardIndex], result.bestListings[localCardIndex]);
    }
    for (const sellerKey of result.activeSellerKeys) {
      activeSellers.add(sellerKey);
    }
  }

  return {
    status: "Optimal",
    objectiveValue,
    chosenListings,
    activeSellers,
    solveTimeMs: Math.round(performance.now() - startTime),
  };
}

function solveComponent(component: ComponentProblem): ComponentSolution {
  const cardCount = component.globalCardIndices.length;
  const fullMask = buildFullMask(cardCount);
  let sellers = component.sellers;
  let state = createEmptySelectionState(cardCount);

  while (true) {
    let changed = false;

    const usefulSellers = sellers.filter((seller) => sellerCanStillMatter(seller, state));
    if (usefulSellers.length !== sellers.length) {
      sellers = usefulSellers;
      changed = true;
    }

    const reducedSellers = removeDominatedSellers(sellers);
    if (reducedSellers.length !== sellers.length) {
      sellers = reducedSellers;
      changed = true;
    }

    const sellersByCard = buildSellersByCard(cardCount, sellers);
    assertAllUncoveredCardsHaveCandidates(cardCount, state.coverageMask, sellersByCard);

    const forcedSellerIndex = findForcedSellerIndex(cardCount, state.coverageMask, sellersByCard);
    if (forcedSellerIndex === null) {
      if (!changed) {
        break;
      }
      continue;
    }

    state = addSellerToState(state, sellers[forcedSellerIndex]);
    sellers = sellers.filter((_, index) => index !== forcedSellerIndex);
  }

  if (masksEqual(state.coverageMask, fullMask)) {
    return {
      activeSellerKeys: state.activeSellerKeys,
      bestListings: state.bestListings,
      totalCostCents: state.totalCostCents,
    };
  }

  const sellersByCard = buildSellersByCard(cardCount, sellers);
  assertAllUncoveredCardsHaveCandidates(cardCount, state.coverageMask, sellersByCard);

  const minCover = buildMinCoverSolver(sellers, sellersByCard);
  const minPossibleCardCost = buildMinPossibleCardCost(cardCount, state, sellers);
  const shippingOrder = sellers
    .map((seller, index) => ({ index, shippingCents: seller.shippingCents }))
    .sort((left, right) => left.shippingCents - right.shippingCents);

  let bestCost = INF;
  let bestListings = state.bestListings.slice();
  let bestSellerIndices: number[] = [];
  const visitedSellerSets = new Set<string>();

  function search(selectedSellerIndices: number[], currentState: SelectionState) {
    const selectedKey = sellerSelectionKey(selectedSellerIndices);
    if (visitedSellerSets.has(selectedKey)) {
      return;
    }
    if (visitedSellerSets.size < MAX_STATE_CACHE) {
      visitedSellerSets.add(selectedKey);
    }

    if (masksEqual(currentState.coverageMask, fullMask)) {
      if (currentState.totalCostCents < bestCost) {
        bestCost = currentState.totalCostCents;
        bestListings = currentState.bestListings.slice();
        bestSellerIndices = selectedSellerIndices.slice();
      }
      return;
    }

    const uncoveredMask = maskAndNot(fullMask, currentState.coverageMask);
    const remainingSellers = minCover(uncoveredMask);
    const additionalShippingFloor = sumCheapestRemainingShipping(
      shippingOrder,
      selectedSellerIndices,
      remainingSellers
    );
    const costFloor = currentState.shippingCents + minPossibleCardCost + additionalShippingFloor;
    if (costFloor >= bestCost) {
      return;
    }

    const pivot = chooseOptimalPivotCard(
      uncoveredMask,
      selectedSellerIndices,
      sellers,
      sellersByCard,
      minCover,
      remainingSellers
    );

    const candidates = pivot.candidates
      .map((sellerIndex) => {
        const seller = sellers[sellerIndex];
        return {
          sellerIndex,
          seller,
          gain: countSellerCoverageGain(uncoveredMask, seller),
          pivotPrice: seller.optionByCard.get(pivot.cardIndex)?.priceCents ?? INF,
        };
      })
      .sort((left, right) => {
        if (left.gain !== right.gain) {
          return right.gain - left.gain;
        }
        if (left.pivotPrice !== right.pivotPrice) {
          return left.pivotPrice - right.pivotPrice;
        }
        if (left.seller.shippingCents !== right.seller.shippingCents) {
          return left.seller.shippingCents - right.seller.shippingCents;
        }
        return left.seller.sellerKey.localeCompare(right.seller.sellerKey);
      });

    for (const candidate of candidates) {
      if (isSellerSelected(selectedSellerIndices, candidate.sellerIndex)) {
        continue;
      }

      const nextState = addSellerToState(currentState, candidate.seller);
      search(insertSellerIndex(selectedSellerIndices, candidate.sellerIndex), nextState);
    }
  }

  search([], state);

  if (!Number.isFinite(bestCost)) {
    throw new Error("Fewest-packages search failed to find a feasible seller set.");
  }

  const activeSellerKeys = [...state.activeSellerKeys];
  for (const sellerIndex of bestSellerIndices) {
    activeSellerKeys.push(sellers[sellerIndex].sellerKey);
  }

  return {
    activeSellerKeys,
    bestListings,
    totalCostCents: bestCost,
  };
}

function collapseListingsToSellers(input: ModelInput): SellerNode[] {
  const sellersByKey = new Map<string, { sellerKey: string; shippingCents: number; options: SellerOption[] }>();

  for (let cardIndex = 0; cardIndex < input.cards.length; cardIndex++) {
    const cheapestBySeller = new Map<string, SellerOption & { shippingCents: number }>();

    for (const listing of input.listingsPerCard[cardIndex]) {
      const existing = cheapestBySeller.get(listing.sellerKey);
      if (
        !existing ||
        listing.priceCents < existing.priceCents ||
        (listing.priceCents === existing.priceCents && listing.shippingCents < existing.shippingCents) ||
        (
          listing.priceCents === existing.priceCents &&
          listing.shippingCents === existing.shippingCents &&
          listing.listingId.localeCompare(existing.listingId) < 0
        )
      ) {
        cheapestBySeller.set(listing.sellerKey, {
          cardIndex,
          priceCents: listing.priceCents,
          listingId: listing.listingId,
          shippingCents: listing.shippingCents,
        });
      }
    }

    for (const [sellerKey, option] of cheapestBySeller) {
      let seller = sellersByKey.get(sellerKey);
      if (!seller) {
        seller = {
          sellerKey,
          shippingCents: option.shippingCents,
          options: [],
        };
        sellersByKey.set(sellerKey, seller);
      } else {
        seller.shippingCents = Math.min(seller.shippingCents, option.shippingCents);
      }

      seller.options.push({
        cardIndex,
        priceCents: option.priceCents,
        listingId: option.listingId,
      });
    }
  }

  return Array.from(sellersByKey.values()).map((seller) => buildSellerNode(seller, input.cards.length));
}

function splitIntoComponents(cardCount: number, sellers: SellerNode[]): ComponentProblem[] {
  const sellersByCard = buildSellersByCard(cardCount, sellers);
  const visitedCards = new Array<boolean>(cardCount).fill(false);
  const visitedSellers = new Array<boolean>(sellers.length).fill(false);
  const components: ComponentProblem[] = [];

  for (let startCard = 0; startCard < cardCount; startCard++) {
    if (visitedCards[startCard]) {
      continue;
    }

    const cardQueue = [startCard];
    visitedCards[startCard] = true;
    const componentCards: number[] = [];
    const componentSellerIndices: number[] = [];

    while (cardQueue.length > 0) {
      const cardIndex = cardQueue.pop()!;
      componentCards.push(cardIndex);

      for (const sellerIndex of sellersByCard[cardIndex]) {
        if (visitedSellers[sellerIndex]) {
          continue;
        }

        visitedSellers[sellerIndex] = true;
        componentSellerIndices.push(sellerIndex);

        for (const option of sellers[sellerIndex].options) {
          if (!visitedCards[option.cardIndex]) {
            visitedCards[option.cardIndex] = true;
            cardQueue.push(option.cardIndex);
          }
        }
      }
    }

    components.push(reindexComponent(componentCards, componentSellerIndices, sellers));
  }

  return components;
}

function reindexComponent(
  globalCardIndices: number[],
  sellerIndices: number[],
  sellers: SellerNode[]
): ComponentProblem {
  const localCardIndexByGlobal = new Map<number, number>();
  for (let localCardIndex = 0; localCardIndex < globalCardIndices.length; localCardIndex++) {
    localCardIndexByGlobal.set(globalCardIndices[localCardIndex], localCardIndex);
  }

  const localSellers = sellerIndices.map((sellerIndex) => {
    const seller = sellers[sellerIndex];
    return buildSellerNode({
      sellerKey: seller.sellerKey,
      shippingCents: seller.shippingCents,
      options: seller.options.map((option) => ({
        cardIndex: localCardIndexByGlobal.get(option.cardIndex)!,
        priceCents: option.priceCents,
        listingId: option.listingId,
      })),
    }, globalCardIndices.length);
  });

  return {
    globalCardIndices,
    sellers: localSellers,
  };
}

function buildSellerNode(
  seller: { sellerKey: string; shippingCents: number; options: SellerOption[] },
  cardCount: number
): SellerNode {
  const coverageMask = createEmptyMask(getWordCount(cardCount));
  const optionByCard = new Map<number, SellerOption>();

  for (const option of seller.options) {
    setCardInMask(coverageMask, option.cardIndex);
    optionByCard.set(option.cardIndex, option);
  }

  return {
    sellerKey: seller.sellerKey,
    shippingCents: seller.shippingCents,
    options: [...seller.options].sort((left, right) => left.cardIndex - right.cardIndex),
    optionByCard,
    coverageMask,
  };
}

function createEmptySelectionState(cardCount: number): SelectionState {
  return {
    coverageMask: createEmptyMask(getWordCount(cardCount)),
    bestPrices: Array.from({ length: cardCount }, () => INF),
    bestListings: Array.from({ length: cardCount }, () => ""),
    shippingCents: 0,
    totalCostCents: 0,
    activeSellerKeys: [],
  };
}

function addSellerToState(state: SelectionState, seller: SellerNode): SelectionState {
  const bestPrices = state.bestPrices.slice();
  const bestListings = state.bestListings.slice();
  const coverageMask = state.coverageMask.slice();
  let totalCostCents = state.totalCostCents + seller.shippingCents;

  for (const option of seller.options) {
    const currentPrice = bestPrices[option.cardIndex];
    if (!Number.isFinite(currentPrice)) {
      bestPrices[option.cardIndex] = option.priceCents;
      bestListings[option.cardIndex] = option.listingId;
      totalCostCents += option.priceCents;
      setCardInMask(coverageMask, option.cardIndex);
      continue;
    }

    if (option.priceCents < currentPrice) {
      bestPrices[option.cardIndex] = option.priceCents;
      bestListings[option.cardIndex] = option.listingId;
      totalCostCents += option.priceCents - currentPrice;
    }
  }

  return {
    coverageMask,
    bestPrices,
    bestListings,
    shippingCents: state.shippingCents + seller.shippingCents,
    totalCostCents,
    activeSellerKeys: [...state.activeSellerKeys, seller.sellerKey],
  };
}

function sellerCanStillMatter(seller: SellerNode, state: SelectionState): boolean {
  for (const option of seller.options) {
    if (!isCardInMask(state.coverageMask, option.cardIndex)) {
      return true;
    }
    if (option.priceCents < state.bestPrices[option.cardIndex]) {
      return true;
    }
  }
  return false;
}

function removeDominatedSellers(sellers: SellerNode[]): SellerNode[] {
  if (sellers.length < 2) {
    return sellers;
  }

  const dominated = new Set<number>();
  const sortedIndices = sellers
    .map((_, index) => index)
    .sort((left, right) => {
      const coverageDiff = sellers[right].options.length - sellers[left].options.length;
      if (coverageDiff !== 0) return coverageDiff;

      const shippingDiff = sellers[left].shippingCents - sellers[right].shippingCents;
      if (shippingDiff !== 0) return shippingDiff;

      return sellers[left].sellerKey.localeCompare(sellers[right].sellerKey);
    });

  for (let leftPos = 0; leftPos < sortedIndices.length; leftPos++) {
    const dominantIndex = sortedIndices[leftPos];
    if (dominated.has(dominantIndex)) {
      continue;
    }

    const dominant = sellers[dominantIndex];
    for (let rightPos = leftPos + 1; rightPos < sortedIndices.length; rightPos++) {
      const candidateIndex = sortedIndices[rightPos];
      if (dominated.has(candidateIndex)) {
        continue;
      }

      const candidate = sellers[candidateIndex];
      if (dominant.shippingCents > candidate.shippingCents) {
        continue;
      }
      if (!isSubsetMask(candidate.coverageMask, dominant.coverageMask)) {
        continue;
      }

      let isDominated = true;
      for (const option of candidate.options) {
        const dominantOption = dominant.optionByCard.get(option.cardIndex);
        if (!dominantOption || dominantOption.priceCents > option.priceCents) {
          isDominated = false;
          break;
        }
      }

      if (isDominated) {
        dominated.add(candidateIndex);
      }
    }
  }

  return sellers.filter((_, index) => !dominated.has(index));
}

function buildSellersByCard(cardCount: number, sellers: SellerNode[]): number[][] {
  const sellersByCard = Array.from({ length: cardCount }, () => [] as number[]);

  for (let sellerIndex = 0; sellerIndex < sellers.length; sellerIndex++) {
    for (const option of sellers[sellerIndex].options) {
      sellersByCard[option.cardIndex].push(sellerIndex);
    }
  }

  return sellersByCard;
}

function assertAllUncoveredCardsHaveCandidates(
  cardCount: number,
  coverageMask: BitMask,
  sellersByCard: number[][]
) {
  for (let cardIndex = 0; cardIndex < cardCount; cardIndex++) {
    if (isCardInMask(coverageMask, cardIndex)) {
      continue;
    }
    if (sellersByCard[cardIndex].length === 0) {
      throw new Error("Fewest-packages search became infeasible after reductions.");
    }
  }
}

function findForcedSellerIndex(
  cardCount: number,
  coverageMask: BitMask,
  sellersByCard: number[][]
): number | null {
  for (let cardIndex = 0; cardIndex < cardCount; cardIndex++) {
    if (isCardInMask(coverageMask, cardIndex)) {
      continue;
    }
    if (sellersByCard[cardIndex].length === 1) {
      return sellersByCard[cardIndex][0];
    }
  }
  return null;
}

function buildMinCoverSolver(
  sellers: SellerNode[],
  sellersByCard: number[][]
): (mask: BitMask) => number {
  const emptyMask = createEmptyMask(getWordCount(sellersByCard.length));
  const memo = new Map<string, number>();
  memo.set(maskKey(emptyMask), 0);

  function solve(mask: BitMask): number {
    const key = maskKey(mask);
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const componentMasks = splitMaskIntoComponents(mask, sellers, sellersByCard);
    if (componentMasks.length > 1) {
      let total = 0;
      for (const componentMask of componentMasks) {
        total += solve(componentMask);
      }
      if (memo.size < MAX_STATE_CACHE) {
        memo.set(key, total);
      }
      return total;
    }

    const pivotCard = choosePivotCard(mask, sellersByCard);
    let best = INF;

    for (const sellerIndex of sellersByCard[pivotCard]) {
      const nextMask = maskAndNot(mask, sellers[sellerIndex].coverageMask);
      const candidate = 1 + solve(nextMask);
      if (candidate < best) {
        best = candidate;
        if (best === 1) {
          break;
        }
      }
    }

    if (memo.size < MAX_STATE_CACHE) {
      memo.set(key, best);
    }
    return best;
  }

  return solve;
}

function splitMaskIntoComponents(
  mask: BitMask,
  sellers: SellerNode[],
  sellersByCard: number[][]
): BitMask[] {
  const components: BitMask[] = [];
  const remainingMask = mask.slice();

  while (!isMaskEmpty(remainingMask)) {
    const startCard = firstSetBit(remainingMask);
    if (startCard === null) {
      break;
    }

    const cardStack = [startCard];
    const componentMask = createEmptyMask(mask.length);
    const visitedSellers = new Set<number>();

    while (cardStack.length > 0) {
      const cardIndex = cardStack.pop()!;
      if (isCardInMask(componentMask, cardIndex) || !isCardInMask(mask, cardIndex)) {
        continue;
      }

      setCardInMask(componentMask, cardIndex);

      for (const sellerIndex of sellersByCard[cardIndex]) {
        if (visitedSellers.has(sellerIndex)) {
          continue;
        }

        const seller = sellers[sellerIndex];
        if (!masksIntersect(seller.coverageMask, mask)) {
          continue;
        }

        visitedSellers.add(sellerIndex);
        for (const option of seller.options) {
          if (isCardInMask(mask, option.cardIndex) && !isCardInMask(componentMask, option.cardIndex)) {
            cardStack.push(option.cardIndex);
          }
        }
      }
    }

    components.push(componentMask);
    subtractMaskInPlace(remainingMask, componentMask);
  }

  return components;
}

function chooseOptimalPivotCard(
  uncoveredMask: BitMask,
  selectedSellerIndices: number[],
  sellers: SellerNode[],
  sellersByCard: number[][],
  minCover: (mask: BitMask) => number,
  remainingSellers: number
): { cardIndex: number; candidates: number[] } {
  let bestCard = -1;
  let bestCandidates: number[] = [];

  for (let cardIndex = 0; cardIndex < sellersByCard.length; cardIndex++) {
    if (!isCardInMask(uncoveredMask, cardIndex)) {
      continue;
    }

    const candidates = sellersByCard[cardIndex].filter((sellerIndex) => {
      if (isSellerSelected(selectedSellerIndices, sellerIndex)) {
        return false;
      }
      const nextMask = maskAndNot(uncoveredMask, sellers[sellerIndex].coverageMask);
      return 1 + minCover(nextMask) === remainingSellers;
    });

    if (candidates.length === 0) {
      throw new Error("Fewest-packages search could not extend an optimal seller cover.");
    }

    if (bestCard === -1 || candidates.length < bestCandidates.length) {
      bestCard = cardIndex;
      bestCandidates = candidates;
      if (bestCandidates.length === 1) {
        break;
      }
    }
  }

  return { cardIndex: bestCard, candidates: bestCandidates };
}

function choosePivotCard(mask: BitMask, sellersByCard: number[][]): number {
  let bestCard = -1;
  let bestCandidateCount = INF;

  for (let cardIndex = 0; cardIndex < sellersByCard.length; cardIndex++) {
    if (!isCardInMask(mask, cardIndex)) {
      continue;
    }

    const candidateCount = sellersByCard[cardIndex].length;
    if (candidateCount < bestCandidateCount) {
      bestCard = cardIndex;
      bestCandidateCount = candidateCount;
      if (candidateCount === 1) {
        break;
      }
    }
  }

  if (bestCard === -1) {
    throw new Error("Tried to choose a pivot card for an empty mask.");
  }

  return bestCard;
}

function buildMinPossibleCardCost(
  cardCount: number,
  state: SelectionState,
  sellers: SellerNode[]
): number {
  const minPrices = state.bestPrices.slice();

  for (const seller of sellers) {
    for (const option of seller.options) {
      if (option.priceCents < minPrices[option.cardIndex]) {
        minPrices[option.cardIndex] = option.priceCents;
      }
    }
  }

  let total = 0;
  for (let cardIndex = 0; cardIndex < cardCount; cardIndex++) {
    if (!Number.isFinite(minPrices[cardIndex])) {
      throw new Error("Fewest-packages search found a card without any reachable seller.");
    }
    total += minPrices[cardIndex];
  }

  return total;
}

function sumCheapestRemainingShipping(
  shippingOrder: Array<{ index: number; shippingCents: number }>,
  selectedSellerIndices: number[],
  count: number
): number {
  if (count <= 0) {
    return 0;
  }

  let total = 0;
  let remaining = count;
  for (const seller of shippingOrder) {
    if (isSellerSelected(selectedSellerIndices, seller.index)) {
      continue;
    }
    total += seller.shippingCents;
    remaining--;
    if (remaining === 0) {
      break;
    }
  }

  return total;
}

function sellerSelectionKey(selectedSellerIndices: number[]): string {
  return selectedSellerIndices.join(",");
}

function isSellerSelected(selectedSellerIndices: number[], sellerIndex: number): boolean {
  for (const selectedIndex of selectedSellerIndices) {
    if (selectedIndex === sellerIndex) {
      return true;
    }
  }
  return false;
}

function insertSellerIndex(selectedSellerIndices: number[], sellerIndex: number): number[] {
  const next = selectedSellerIndices.slice();
  let insertAt = next.length;

  for (let index = 0; index < next.length; index++) {
    if (sellerIndex < next[index]) {
      insertAt = index;
      break;
    }
  }

  next.splice(insertAt, 0, sellerIndex);
  return next;
}

function countSellerCoverageGain(mask: BitMask, seller: SellerNode): number {
  let count = 0;
  for (const option of seller.options) {
    if (isCardInMask(mask, option.cardIndex)) {
      count++;
    }
  }
  return count;
}

function getWordCount(cardCount: number): number {
  return Math.ceil(cardCount / 32);
}

function createEmptyMask(wordCount: number): BitMask {
  return Array.from({ length: wordCount }, () => 0);
}

function buildFullMask(cardCount: number): BitMask {
  const wordCount = getWordCount(cardCount);
  if (wordCount === 0) {
    return [];
  }

  const mask = new Array<number>(wordCount).fill(0xffffffff);
  const partialBits = cardCount & 31;
  if (partialBits !== 0) {
    mask[wordCount - 1] = ((2 ** partialBits) - 1) >>> 0;
  }

  return mask;
}

function masksEqual(left: BitMask, right: BitMask): boolean {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function isMaskEmpty(mask: BitMask): boolean {
  for (const word of mask) {
    if (word !== 0) {
      return false;
    }
  }
  return true;
}

function masksIntersect(left: BitMask, right: BitMask): boolean {
  for (let index = 0; index < left.length; index++) {
    if ((left[index] & right[index]) !== 0) {
      return true;
    }
  }
  return false;
}

function isSubsetMask(subset: BitMask, superset: BitMask): boolean {
  for (let index = 0; index < subset.length; index++) {
    if ((subset[index] & ~superset[index]) !== 0) {
      return false;
    }
  }
  return true;
}

function maskAndNot(left: BitMask, right: BitMask): BitMask {
  const next = new Array<number>(left.length);
  for (let index = 0; index < left.length; index++) {
    next[index] = (left[index] & ~right[index]) >>> 0;
  }
  return next;
}

function subtractMaskInPlace(target: BitMask, remove: BitMask): void {
  for (let index = 0; index < target.length; index++) {
    target[index] = (target[index] & ~remove[index]) >>> 0;
  }
}

function isCardInMask(mask: BitMask, cardIndex: number): boolean {
  const bit = 1 << (cardIndex & 31);
  return (mask[cardIndex >>> 5] & bit) !== 0;
}

function setCardInMask(mask: BitMask, cardIndex: number): void {
  const wordIndex = cardIndex >>> 5;
  const bit = 1 << (cardIndex & 31);
  mask[wordIndex] = (mask[wordIndex] | bit) >>> 0;
}

function firstSetBit(mask: BitMask): number | null {
  for (let wordIndex = 0; wordIndex < mask.length; wordIndex++) {
    const word = mask[wordIndex] >>> 0;
    if (word === 0) {
      continue;
    }

    const lowestBit = word & -word;
    return (wordIndex * 32) + (31 - Math.clz32(lowestBit));
  }
  return null;
}

function maskKey(mask: BitMask): string {
  return mask.join(",");
}
