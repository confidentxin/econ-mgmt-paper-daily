import { IntentLink } from "../components/ui/IntentLink";
import { SITE, withSubject } from "@aihot/site";
import { pageHeaders } from "../lib/api.server";
import { breadcrumbLd, pageMeta } from "../lib/seo";
import { EmptyState, ReadingLayout } from "../components/ui/Page";
import type { Screen } from "../components/shell/screens";
import { navUp } from "../components/shell/nav";

export const handle: Screen = { tab: navUp("/hot").tab, name: "热点" };
export const headers = pageHeaders;

export function meta() {
  return pageMeta({
    title: `${withSubject("热点榜")}：暂未开放`,
    description: "热度榜将结合被引次数和下载量，目前尚未接入这些数据。",
    path: "/hot",
    noindex: true,
    jsonLd: breadcrumbLd([{ name: SITE.name, path: "/" }, { name: withSubject("热点榜"), path: "/hot" }]),
  });
}

export default function Hot() {
  return (
    <ReadingLayout>
      <EmptyState
        title={<h1 className="text-ui-body font-semibold text-ink-2">热点榜暂未开放</h1>}
        action={<IntentLink to="/" className="text-ui-label font-semibold text-accent">去看今日精选</IntentLink>}
      >
        论文热度将结合被引次数和下载量，现在还没有接入这些数据。当前可以先按研究领域、论文类型和话题浏览。
      </EmptyState>
    </ReadingLayout>
  );
}
