import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { DepositErrorNotice, METHOD_COPY, MethodIcon, useMiniappMethods } from "../components/deposit"
import { Button, Spinner } from "../components/ui"
import { useNav } from "../navigation"
import type { DepositMethod } from "../payments/deposit"
import { CryptoDeposit } from "./deposit/CryptoDeposit"
import { GiftCodeDeposit } from "./deposit/GiftCodeDeposit"
import { VoucherDeposit } from "./deposit/VoucherDeposit"

/** The card form carries the phone-number rules, so it is only downloaded when opened. */
const CardDeposit = lazy(() => import("./deposit/CardDeposit").then((m) => ({ default: m.CardDeposit })))

function Flow({ method }: { method: DepositMethod }) {
  switch (method) {
    case "card":
      return (
        <Suspense fallback={<Spinner />}>
          <CardDeposit />
        </Suspense>
      )
    case "crypto":
      return <CryptoDeposit />
    case "voucher":
      return <VoucherDeposit />
    default:
      return <GiftCodeDeposit />
  }
}

/** One deposit method, inside the app. A method switched off by the admins shows why and goes back. */
export function DepositScreen({ method }: { method: DepositMethod }) {
  const { t } = useTranslation()
  const nav = useNav()
  const methods = useMiniappMethods()
  const copy = METHOD_COPY[method]
  const off = methods.data ? !methods.data[method] : false

  return (
    <div className="stack">
      <header className="deposit-head">
        <span className="method-badge-icon">
          <MethodIcon method={method} />
        </span>
        <span className="method-text">
          <h1 className="section-title">{t(copy.title)}</h1>
          <span className="method-sub">{t(copy.subtitle)}</span>
        </span>
      </header>
      {methods.isPending ? (
        <Spinner />
      ) : off ? (
        <>
          <DepositErrorNotice errorKey="miniapp_method_disabled" />
          <Button variant="secondary" onClick={() => nav.replace({ name: "add-funds" })}>
            {t("See other ways to pay")}
          </Button>
        </>
      ) : (
        <Flow method={method} />
      )}
    </div>
  )
}
