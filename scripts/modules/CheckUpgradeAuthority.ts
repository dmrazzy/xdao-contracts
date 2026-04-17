import 'dotenv/config'

import { ethers, network, upgrades } from 'hardhat'

const PROXY_BY_CHAIN: Record<number, string> = {
  1: '0x711E14eBC41A8f1595433FA4409a50BC9838Fc03',
  56: '0x97330364E1a9209214ef5107a04798170D351b68',
  137: '0x8AC7D4cEA044fB0d0153c28d145aE350bA25f1bA',
  43114: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd',
  204: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd',
  10: '0xaB5836182cc9970695faa74A0890Cd7099955d5a',
  8453: '0x0b7b154c7dB7d50a500a3eF89eddc9A746787185',
  5000: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd',
  42161: '0x0cf784bba0FFA0a7006f3Ee7e4357E643a07F6e7',
  42170: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd',
  84531: '0x03e40dB4dcE9Fec44232B942440a1BC65563f001'
}

const DEFAULT_ADMIN_ROLE =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

const EXPECTED_ADMIN = '0x8B437841e8B031b0178173732002bc0a4AF84BE3'

const main = async () => {
  const chainId = network.config.chainId
  if (!chainId) throw new Error('chainId missing')

  const proxy = PROXY_BY_CHAIN[chainId]
  if (!proxy) throw new Error(`No proxy configured for chainId ${chainId}`)

  console.log(`Network chainId: ${chainId}`)
  console.log(`Proxy:           ${proxy}`)
  console.log(`Expected admin:  ${EXPECTED_ADMIN}`)

  const moduleAbi = [
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function factory() view returns (address)',
    'function shop() view returns (address)',
    'function privateExitModule() view returns (address)',
    'function vestingModule() view returns (address)',
    'function feeAddress() view returns (address)',
    'function regularFeeRate() view returns (uint256)',
    'function discountFeeRate() view returns (uint256)'
  ]

  const module = await ethers.getContractAt(moduleAbi, proxy)

  const hasRole: boolean = await module.hasRole(
    DEFAULT_ADMIN_ROLE,
    EXPECTED_ADMIN
  )
  console.log(`hasRole(DEFAULT_ADMIN_ROLE, expected): ${hasRole}`)

  const impl = await upgrades.erc1967.getImplementationAddress(proxy)
  console.log(`Current implementation: ${impl}`)

  const snapshot = {
    factory: await module.factory(),
    shop: await module.shop(),
    privateExitModule: await module.privateExitModule(),
    vestingModule: await module.vestingModule(),
    feeAddress: await module.feeAddress(),
    regularFeeRate: (await module.regularFeeRate()).toString(),
    discountFeeRate: (await module.discountFeeRate()).toString()
  }
  console.log('Storage snapshot (for pre/post upgrade diff):')
  console.log(JSON.stringify(snapshot, null, 2))

  if (!hasRole) {
    console.error(
      `ABORT: ${EXPECTED_ADMIN} is NOT admin on chainId ${chainId}. Do not upgrade.`
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
