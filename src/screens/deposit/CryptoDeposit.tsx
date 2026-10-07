import { useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../../api"
import { AmountField, DepositErrorNotice, useUsdRate } from "../../components/deposit"
import { Alert, Button, Spinner } from "../../components/ui"
import { formatMoney } from "../../format"
import { currentLanguage } from "../../i18n"
import { useNav } from "../../navigation"
import {
  depositErrorKey,
  fetchCryptoCoins,
  fetchCryptoMinimum,
  formatCrypto,
  minimumIn,
  networkLabel,
  parseAmount,
  quickAmounts,
  startCryptoPayment,
} from "../../payments/deposit"
import { haptic } from "../../telegram"

/** The website preselects Tron: lowest fees for USDT. */
const PREFERRED_COIN = "TRX"

/**
 * Crypto top-up: pick a coin and network, enter the amount, then the payment
 * screen shows the address, the exact amount and the time left.
 */
export function CryptoDeposit() {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const nav = useNav()
  const currency = getDisplayCurrency()
  const rate = useUsdRate(currency)
  const coins = useQuery({ queryKey: ["deposit", "crypto", "coins"], staleTime: 5 * 60_000, queryFn: fetchCryptoCoins })

  const [symbol, setSymbol] = useState<string | null>(null)
  const [ticker, setTicker] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const list = coins.data ?? []
  const coin = list.find((c) => c.symbol === symbol) ?? list.find((c) => c.symbol === PREFERRED_COIN) ?? list[0] ?? null
  const network = coin?.networks.find((n) => n.ticker === ticker) ?? coin?.networks[0] ?? null

  const min = useQuery({
    queryKey: ["deposit", "crypto", "min", network?.ticker ?? ""],
    enabled: Boolean(network),
    staleTime: 60_000,
    queryFn: () => fetchCryptoMinimum(network?.ticker ?? ""),
  })
  const minimum = min.data?.minUsd != null && rate.data ? minimumIn(min.data.minUsd, rate.data) : null

  if (coins.isPending || rate.isPending) return <Spinner />
  if (coins.isError || !coin || !network) {
    return (
      <div className="stack">
        {coins.isError ? (
          <DepositErrorNotice errorKey={depositErrorKey(coins.error, "crypto")} />
        ) : (
          <Alert tone="info">{t("No cryptocurrency is available right now. Please try again later.")}</Alert>
        )}
        <Button variant="secondary" onClick={() => void coins.refetch()}>
          {t("Try again")}
        </Button>
      </div>
    )
  }

  const pay = async () => {
    if (inFlight.current) return
    setErrorKey(null)
    setProblem(null)
    const value = parseAmount(amount)
    if (value == null) {
      setProblem(t("Enter an amount"))
      haptic("error")
      return
    }
    if (minimum != null && value < minimum) {
      setProblem(t("At least {{amount}} is required", { amount: formatMoney(minimum, currency, lang) }))
      haptic("error")
      return
    }
    inFlight.current = true
    setBusy(true)
    try {
      const started = await startCryptoPayment({ amount: value, ticker: network.ticker })
      nav.replace({ name: "payment", paymentId: started.paymentId })
    } catch (err) {
      setErrorKey(depositErrorKey(err, "crypto"))
      haptic("error")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void pay()
      }}
    >
      <section className="card" aria-labelledby="crypto-coin-title">
        <h2 id="crypto-coin-title" className="card-title">
          {t("Select cryptocurrency")}
        </h2>
        <div className="chip-row" role="radiogroup" aria-labelledby="crypto-coin-title">
          {list.map((c) => (
            <button
              key={c.symbol}
              type="button"
              role="radio"
              aria-checked={c.symbol === coin.symbol}
              className={`chip${c.symbol === coin.symbol ? " chip-active" : ""}`}
              onClick={() => {
                setSymbol(c.symbol)
                setTicker(null)
                setErrorKey(null)
              }}
            >
              <span dir="ltr">{c.symbol}</span>
              <span className="chip-sub">{lang === "fa" ? c.faName : c.name}</span>
            </button>
          ))}
        </div>

        {coin.networks.length > 1 ? (
          <>
            <h3 id="crypto-network-title" className="field-label">
              {t("Select network")}
            </h3>
            <div className="chip-row" role="radiogroup" aria-labelledby="crypto-network-title">
              {coin.networks.map((n) => (
                <button
                  key={n.ticker}
                  type="button"
                  role="radio"
                  aria-checked={n.ticker === network.ticker}
                  className={`chip${n.ticker === network.ticker ? " chip-active" : ""}`}
                  onClick={() => {
                    setTicker(n.ticker)
                    setErrorKey(null)
                  }}
                >
                  <span dir="ltr">{networkLabel("", n.ticker, n.label)}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted small">
            {t("Network")}: <span dir="ltr">{networkLabel("", network.ticker, network.label)}</span>
          </p>
        )}
      </section>

      <section className="card">
        <AmountField
          value={amount}
          onChange={setAmount}
          currency={currency}
          minimum={minimum}
          quick={rate.data ? quickAmounts(rate.data, minimum ?? 0) : []}
          hint={
            min.isPending ? (
              t("Checking minimum amount…")
            ) : min.data && min.data.minCrypto > 0 ? (
              <span>
                {t("Minimum: {{amount}} {{asset}}", { amount: formatCrypto(min.data.minCrypto), asset: min.data.asset })}
              </span>
            ) : undefined
          }
        />
        <p className="muted small">
          {t("Next you'll see the wallet address and the exact amount to send. Your wallet is topped up once the network confirms the transfer.")}
        </p>
      </section>

      {errorKey ? <DepositErrorNotice errorKey={errorKey} /> : null}
      {problem ? <Alert tone="error">{problem}</Alert> : null}

      <Button type="submit" busy={busy}>
        {t("Get payment address")}
      </Button>
    </form>
  )
}
