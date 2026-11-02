import { InfoBanner, PageShell } from '../components/ui'

/**
 * 还没接数据源的域：把「缺什么」写清楚，比放一个空图表有用。
 * 两张卡分别对应 `console-architecture.md` 的 S2 / S3。
 */
export function PlaceholderPage({
  title,
  summary,
  missing,
  plan,
}: {
  title: string
  summary: string
  missing: string[]
  plan: string[]
}) {
  return (
    <PageShell title={title} summary={summary}>
      <InfoBanner tone="warn">
        这一域**还没有数据源**。页面先占位，避免用假数据把「没接」显示成「正常」。
      </InfoBanner>

      <section className="block block--narrow">
        <h2 className="card__title">缺什么</h2>
        <ul className="bullets">
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="block block--narrow">
        <h2 className="card__title">按什么顺序接</h2>
        <ol className="steps">
          {plan.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
    </PageShell>
  )
}
