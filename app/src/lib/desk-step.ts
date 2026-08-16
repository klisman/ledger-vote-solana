export type DeskStep =
  | "connect"
  | "program"
  | "fund"
  | "open"
  | "poll"
  | "tokens"
  | "vote"
  | "thaw"
  | "board";

export type DeskSnapshot = {
  connected: boolean;
  programLoaded: boolean;
  lamports: bigint | null;
  hasConfig: boolean;
  isAuthority: boolean;
  pollCount: number;
  tokenBalance: bigint | null;
  canMint: boolean;
  hasOpenUnvotedPoll: boolean;
  canThaw: boolean;
};

const COPY: Record<DeskStep, { mark: string; title: string; lede: string }> = {
  connect: {
    mark: "Start",
    title: "Connect a wallet",
    lede: "Approve each action in your wallet. This book only talks to the network in the header.",
  },
  program: {
    mark: "Network",
    title: "The poll program is not on this network",
    lede: "Start a local validator with the program loaded, then refresh.",
  },
  fund: {
    mark: "Fees",
    title: "This wallet needs SOL",
    lede: "Airdrops to the CLI key do not reach Phantom. Fund the address shown here, then refresh.",
  },
  open: {
    mark: "1",
    title: "Open the poll book",
    lede: "Creates a vote token in this wallet and records you as clerk. Weight is the square root of the token balance, locked when someone votes.",
  },
  poll: {
    mark: "2",
    title: "Write the first question",
    lede: "Two to four options. You can lock the poll later; until then, anyone with tokens can vote once.",
  },
  tokens: {
    mark: "Tokens",
    title: "You need a vote balance",
    lede: "A vote reads the tokens in this wallet and freezes them so the same pile cannot vote twice.",
  },
  vote: {
    mark: "Vote",
    title: "Cast your vote",
    lede: "Your weight is locked from today’s balance. One vote per question.",
  },
  thaw: {
    mark: "Unfreeze",
    title: "Unfreeze your tokens",
    lede: "The question is closed. You can move tokens again.",
  },
  board: {
    mark: "Book",
    title: "The poll book",
    lede: "Questions, tallies, and your receipt live here.",
  },
};

export function deskStep(s: DeskSnapshot): DeskStep {
  if (!s.connected) return "connect";
  if (!s.programLoaded) return "program";
  if (s.lamports === 0n) return "fund";
  if (!s.hasConfig) return "open";
  if (s.isAuthority && s.pollCount === 0) return "poll";
  const powerless = s.tokenBalance == null || s.tokenBalance === 0n;
  if (powerless && (s.hasOpenUnvotedPoll || s.canMint)) return "tokens";
  if (s.hasOpenUnvotedPoll && s.tokenBalance != null && s.tokenBalance > 0n) {
    return "vote";
  }
  if (s.canThaw) return "thaw";
  return "board";
}

export function deskStepCopy(step: DeskStep) {
  return COPY[step];
}
