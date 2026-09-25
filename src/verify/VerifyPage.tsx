import { useEffect, useState } from 'react'
import { formatYear } from '../app/i18n/format.ts'
import { useT } from '../app/i18n/index.ts'
import { INHERITANCE_CASE, MERGE_CASE } from '../engine/golden.ts'
import {
  runCollapseCheck,
  runGoldenChecks,
  runInheritanceCheck,
  runMergeCheck,
  type CollapseResult,
  type GoldenResult,
  type InheritanceResult,
  type MergeResult,
} from './check.ts'

export function VerifyPage() {
  const t = useT()
  const [results, setResults] = useState<readonly GoldenResult[] | null>(null)
  const [collapse, setCollapse] = useState<CollapseResult | null>(null)
  const [inheritance, setInheritance] = useState<InheritanceResult | null>(null)
  const [merge, setMerge] = useState<MergeResult | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setResults(runGoldenChecks())
      setCollapse(runCollapseCheck())
      setInheritance(runInheritanceCheck())
      setMerge(runMergeCheck())
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  const failed = results?.filter((result) => !result.ok).length ?? 0

  return (
    <main className="verify">
      <a className="wordmark verify__home" href="./">
        {t('app.name')}
      </a>
      <h1 className="verify__title">{t('verify.title')}</h1>
      <p className="verify__lead">{t('verify.lead')}</p>
      <p className="verify__status" role="status">
        {results === null
          ? t('verify.running')
          : failed === 0
            ? t('verify.passed', { count: results.length })
            : t('verify.failed', { failed, count: results.length })}
      </p>
      {results && (
        <table className="verify__table">
          <thead>
            <tr>
              <th scope="col">{t('verify.seed')}</th>
              <th scope="col">{t('verify.decisions')}</th>
              <th scope="col">{t('verify.year')}</th>
              <th scope="col">{t('verify.expected')}</th>
              <th scope="col">{t('verify.computed')}</th>
              <th scope="col">{t('verify.result')}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={`${result.seed}/${result.script}/${result.year}`} data-ok={result.ok}>
                <td>{result.seed}</td>
                <td>{t(`verify.script.${result.script}`)}</td>
                <td>{formatYear(result.year)}</td>
                <td>
                  <code>{result.hash}</code>
                </td>
                <td>
                  <code>{result.computed}</code>
                </td>
                <td>{result.ok ? t('verify.match') : t('verify.mismatch')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 className="verify__title">{t('verify.collapse.title')}</h2>
      <p className="verify__lead">{t('verify.collapse.lead')}</p>
      <p className="verify__status" role="status">
        {collapse === null
          ? t('verify.collapse.running')
          : collapse.ok
            ? t('verify.collapse.passed')
            : t('verify.collapse.mismatch')}
      </p>
      {collapse && (
        <table className="verify__table">
          <thead>
            <tr>
              <th scope="col">{t('verify.seed')}</th>
              <th scope="col">{t('verify.decisions')}</th>
              <th scope="col">{t('verify.year')}</th>
              <th scope="col">{t('verify.expected')}</th>
              <th scope="col">{t('verify.computed')}</th>
              <th scope="col">{t('verify.result')}</th>
            </tr>
          </thead>
          <tbody>
            <tr data-ok={collapse.ok}>
              <td>{collapse.seed}</td>
              <td>{t('verify.collapse.script')}</td>
              <td>{formatYear(collapse.year)}</td>
              <td>
                <code>{collapse.hash}</code>
              </td>
              <td>
                <code>{collapse.computed}</code>
              </td>
              <td>{collapse.ok ? t('verify.match') : t('verify.mismatch')}</td>
            </tr>
          </tbody>
        </table>
      )}
      <h2 className="verify__title">{t('verify.inheritance.title')}</h2>
      <p className="verify__lead">
        {t('verify.inheritance.lead', {
          founded: formatYear(INHERITANCE_CASE.founded),
          ended: formatYear(INHERITANCE_CASE.ended),
          year: formatYear(INHERITANCE_CASE.year),
        })}
      </p>
      <p className="verify__status" role="status">
        {inheritance === null
          ? t('verify.inheritance.running')
          : inheritance.ok
            ? t('verify.inheritance.passed')
            : t('verify.inheritance.mismatch')}
      </p>
      {inheritance && (
        <table className="verify__table">
          <thead>
            <tr>
              <th scope="col">{t('verify.seed')}</th>
              <th scope="col">{t('verify.decisions')}</th>
              <th scope="col">{t('verify.year')}</th>
              <th scope="col">{t('verify.expected')}</th>
              <th scope="col">{t('verify.computed')}</th>
              <th scope="col">{t('verify.result')}</th>
            </tr>
          </thead>
          <tbody>
            <tr data-ok={inheritance.ok}>
              <td>{inheritance.seed}</td>
              <td>{t('verify.inheritance.script')}</td>
              <td>{formatYear(inheritance.year)}</td>
              <td>
                <code>{inheritance.hash}</code>
              </td>
              <td>
                <code>{inheritance.computed}</code>
              </td>
              <td>{inheritance.ok ? t('verify.match') : t('verify.mismatch')}</td>
            </tr>
          </tbody>
        </table>
      )}
      <h2 className="verify__title">{t('verify.merge.title')}</h2>
      <p className="verify__lead">
        {t('verify.merge.lead', {
          tick: formatYear(MERGE_CASE.tick),
          year: formatYear(MERGE_CASE.year),
        })}
      </p>
      <p className="verify__status" role="status">
        {merge === null
          ? t('verify.merge.running')
          : merge.ok
            ? t('verify.merge.passed')
            : t('verify.merge.mismatch')}
      </p>
      {merge && (
        <table className="verify__table">
          <thead>
            <tr>
              <th scope="col">{t('verify.seed')}</th>
              <th scope="col">{t('verify.decisions')}</th>
              <th scope="col">{t('verify.year')}</th>
              <th scope="col">{t('verify.expected')}</th>
              <th scope="col">{t('verify.computed')}</th>
              <th scope="col">{t('verify.result')}</th>
            </tr>
          </thead>
          <tbody>
            <tr data-ok={merge.ok}>
              <td>{merge.seed}</td>
              <td>{t('verify.merge.script')}</td>
              <td>{formatYear(merge.year)}</td>
              <td>
                <code>{merge.hash}</code>
              </td>
              <td>
                <code>{merge.computed}</code>
              </td>
              <td>{merge.ok ? t('verify.match') : t('verify.mismatch')}</td>
            </tr>
          </tbody>
        </table>
      )}
      <a className="verify__back" href="./">
        {t('verify.back')}
      </a>
    </main>
  )
}
