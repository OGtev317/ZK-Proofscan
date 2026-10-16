import { prepareWalletReview, matchesWalletReview } from 'lumenlenz/review';

/** Drop into a Scaffold Stellar frontend. No React/wallet dependency and no signing side effect.
 * Give showDetails the structured preview and require an explicit user acknowledgement.
 * The returned boolean only means the SAME envelope/network was acknowledged, never "safe".
 */
export async function reviewBeforeWallet(
  unsignedXdr: string,
  network: string,
  showDetails: (review: ReturnType<typeof prepareWalletReview>) => Promise<boolean>,
  currentEnvelope: () => { xdr: string; network: string },
): Promise<boolean> {
  const review = prepareWalletReview(unsignedXdr, network);
  if (review.kind !== 'local-review' || !(await showDetails(review))) return false;
  const current = currentEnvelope();
  return matchesWalletReview(review, current.xdr, current.network);
}
