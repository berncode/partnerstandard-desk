// The MAP page's loading skeleton, inside the app frame.
import { COPY } from '@partner-desk/copy';
import { CardSkeleton, Loading } from '@/ui/loading';

export function PlanSkeleton() {
  return (
    <Loading label={COPY.MAP_LOADING} className="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <CardSkeleton lines={3} className="lg:col-span-2" />
      <div className="space-y-4">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={9} />
      </div>
      <CardSkeleton lines={9} />
    </Loading>
  );
}
