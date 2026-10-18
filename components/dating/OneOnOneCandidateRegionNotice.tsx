// Display-only hint from the recommendation API; unknown/legacy responses stay quiet.
export default function OneOnOneCandidateRegionNotice({ widened }: { widened?: boolean }) {
  return widened === true ? (
    <p data-candidate-region-notice className="mt-1 text-xs font-normal leading-5 text-neutral-500">
      조금 더 넓은 지역의 후보예요.
    </p>
  ) : null;
}
