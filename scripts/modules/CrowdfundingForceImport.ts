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

const main = async () => {
  const chainId = network.config.chainId
  if (!chainId) throw new Error('chainId missing')

  const proxy = PROXY_BY_CHAIN[chainId]
  if (!proxy) throw new Error(`No proxy configured for chainId ${chainId}`)

  console.log(`ForceImport on chainId ${chainId}, proxy ${proxy}`)

  const CrowdfundingModule = await ethers.getContractFactory(
    'CrowdfundingModule'
  )

  const imported = await upgrades.forceImport(proxy, CrowdfundingModule, {
    kind: 'uups'
  })

  const impl = await upgrades.erc1967.getImplementationAddress(proxy)
  console.log(`Imported proxy ${imported.address}`)
  console.log(`Current implementation: ${impl}`)
  console.log(
    `Manifest written to .openzeppelin/ — commit it before upgradeProxy.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
