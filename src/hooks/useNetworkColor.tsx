import { useMemo } from 'react'
import { NetTypes } from '@helium/address'
import { Color } from '@theme/theme'
import { useAppStorage } from '../storage/AppStorageProvider'

export default ({
  defaultColor,
  netType,
  muted,
}: {
  netType?: NetTypes.NetType
  defaultColor?: Color
  muted?: boolean
}) => {
  const { l1Network } = useAppStorage()
  return useMemo(() => {
    if (netType === NetTypes.TESTNET) {
      if (muted) {
        return 'lividBrown'
      }
      return 'testnet'
    }
    if (l1Network === 'solana') return 'solanaPurple'
    if (defaultColor) {
      return defaultColor
    }
  }, [defaultColor, l1Network, muted, netType])
}
