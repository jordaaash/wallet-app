import { Address } from '@helium/crypto-react-native'
import Balance, {
  CurrencyType,
  DataCredits,
  NetworkTokens,
  TestNetworkTokens,
} from '@helium/currency'
import { PaymentV2, TokenBurnV1, Transaction } from '@helium/transactions'
import React, { createContext, ReactNode, useContext, useEffect } from 'react'
import { encodeMemoString } from '../components/MemoInput'
import {
  useAccountLazyQuery,
  useAccountQuery,
  useTxnConfigVarsQuery,
} from '../generated/graphql'
import { useAccountStorage } from './AccountStorageProvider'

export const EMPTY_B58_ADDRESS = Address.fromB58(
  '13PuqyWXzPYeXcF1B9ZRx7RLkEygeL374ZABiQdwRSNzASdA1sn',
)

export type SendDetails = {
  payee: string
  balanceAmount: Balance<NetworkTokens> | Balance<TestNetworkTokens>
  memo: string
}

type PartialPaymentTxn = {
  type: string
  payments: {
    payee: string
    memo: string | undefined
    amount: number
  }[]
  payer: string | undefined
  nonce: number | undefined
  fee: number | undefined
}

const useTransactionHook = ({ clientReady }: { clientReady: boolean }) => {
  const { getKeypair, currentAccount } = useAccountStorage()
  const { data: txnVarsData, error } = useTxnConfigVarsQuery({
    fetchPolicy: 'cache-and-network',
    skip: !clientReady,
  })
  const [fetchAccount] = useAccountLazyQuery({
    variables: {
      address: currentAccount?.address || '',
    },
    fetchPolicy: 'cache-and-network',
  })

  const { data: accountData } = useAccountQuery({
    variables: {
      address: currentAccount?.address || '',
    },
    fetchPolicy: 'cache-only',
    skip: !currentAccount?.address || !clientReady,
  })

  useEffect(() => {
    if (!txnVarsData?.txnConfigVars) return

    Transaction.config(txnVarsData.txnConfigVars)
  }, [txnVarsData, error])

  const makeBurnTxn = async ({
    payeeB58,
    amount,
    nonce,
    memo,
    dcPayloadSize,
    txnFeeMultiplier,
  }: {
    amount: number
    payeeB58: string
    nonce: number
    memo: string
    dcPayloadSize?: number
    txnFeeMultiplier?: number
  }) => {
    const keypair = await getKeypair()
    if (!keypair) throw new Error('missing keypair')
    const payee = Address.fromB58(payeeB58)

    if (dcPayloadSize && txnFeeMultiplier) {
      Transaction.config({ dcPayloadSize, txnFeeMultiplier })
    }

    const tokenBurnTxn = new TokenBurnV1({
      payer: keypair.address,
      payee,
      amount,
      nonce,
      memo,
    })

    return tokenBurnTxn.sign({ payer: keypair })
  }

  const makePaymentTxn = async (
    paymentDetails: Array<SendDetails>,
  ): Promise<{ partialTxn: PartialPaymentTxn; signedTxn: PaymentV2 }> => {
    const keypair = await getKeypair()
    if (!keypair) throw new Error('missing keypair')

    const { data: freshAccountData } = await fetchAccount()
    if (typeof freshAccountData?.account?.speculativeNonce !== 'number') {
      throw new Error(
        'Could not find speculative nonce for the current account',
      )
    }

    const txn = new PaymentV2({
      payer: keypair.address,
      payments: paymentDetails.map(
        ({ payee: address, balanceAmount, memo }) => ({
          payee: Address.fromB58(address),
          amount: balanceAmount.integerBalance,
          memo: encodeMemoString(memo),
        }),
      ),
      nonce: freshAccountData.account.speculativeNonce + 1,
    })

    const txnJson = {
      type: txn.type,
      payments: txn.payments.map((p) => ({
        payee: p.payee.b58,
        memo: p.memo,
        amount: p.amount,
      })),
      payer: txn.payer?.b58,
      nonce: txn.nonce,
      fee: txn.fee,
    }
    const signedTxn = await txn.sign({ payer: keypair })

    return { signedTxn, partialTxn: txnJson }
  }

  const calculatePaymentTxnFee = async (paymentDetails: Array<SendDetails>) => {
    if (!currentAccount?.address) {
      throw new Error(
        'Cannot calculate payment txn fee. Current account not found',
      )
    }
    const paymentTxn = new PaymentV2({
      payer: Address.fromB58(currentAccount.address),
      payments: paymentDetails.map(
        ({ payee: address, balanceAmount, memo }) => ({
          // if a payee address isn't supplied, we use a dummy address
          payee:
            address && Address.isValid(address)
              ? Address.fromB58(address)
              : EMPTY_B58_ADDRESS,
          amount: balanceAmount.integerBalance,
          memo: encodeMemoString(memo),
        }),
      ),
      nonce: (accountData?.account?.nonce || 0) + 1,
    })

    return new Balance(paymentTxn.fee || 0, CurrencyType.dataCredit)
  }

  return { makeBurnTxn, calculatePaymentTxnFee, makePaymentTxn }
}

const initialState = {
  calculatePaymentTxnFee: () =>
    new Promise<Balance<DataCredits>>((resolve) =>
      resolve(new Balance(0, CurrencyType.dataCredit)),
    ),
  makeBurnTxn: () =>
    new Promise<TokenBurnV1>((resolve) =>
      resolve(
        new TokenBurnV1({
          payer: EMPTY_B58_ADDRESS,
          payee: EMPTY_B58_ADDRESS,
          amount: 0,
          nonce: 0,
          memo: '',
        }),
      ),
    ),
  makePaymentTxn: () =>
    new Promise<{ partialTxn: PartialPaymentTxn; signedTxn: PaymentV2 }>(
      (resolve) =>
        resolve({
          signedTxn: new PaymentV2({ payer: EMPTY_B58_ADDRESS, payments: [] }),
          partialTxn: {
            type: 'payment_v2',
            payments: [],
            payer: '',
            nonce: 0,
            fee: 0,
          },
        }),
    ),
}

const TransactionContext =
  createContext<ReturnType<typeof useTransactionHook>>(initialState)
const { Provider } = TransactionContext

const TransactionProvider = ({
  children,
  clientReady,
}: {
  children: ReactNode
  clientReady: boolean
}) => {
  return (
    <Provider value={useTransactionHook({ clientReady })}>{children}</Provider>
  )
}

export const useTransactions = () => useContext(TransactionContext)

export default TransactionProvider
