import 'dotenv/config'

import { ethers, network, run, upgrades } from 'hardhat'

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
  42170: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd'
}

const main = async () => {
  const chainId = network.config.chainId
  if (!chainId) throw new Error('chainId missing')
  const proxy = PROXY_BY_CHAIN[chainId]
  if (!proxy) throw new Error(`No proxy configured for chainId ${chainId}`)

  const [signer] = await ethers.getSigners()
  console.log(`chainId ${chainId}, proxy ${proxy}, signer ${signer.address}`)

  const CrowdfundingModule = await ethers.getContractFactory(
    'CrowdfundingModule',
    signer
  )

  // Step 1: deploy a fresh implementation bypassing OZ's impl-caching.
  console.log(`Deploying fresh implementation…`)
  const fresh = await CrowdfundingModule.deploy()
  await fresh.deployed()
  const newImpl = fresh.address
  console.log(`New impl deployed at: ${newImpl}`)

  // Step 2: raw UUPS upgradeTo as admin.
  const proxyAbi = [
    'function upgradeTo(address newImplementation)',
    'function hasRole(bytes32 role, address account) view returns (bool)'
  ]
  const p = new ethers.Contract(proxy, proxyAbi, signer)
  const admin = await p.hasRole(
    '0x' + '0'.repeat(64),
    signer.address
  )
  if (!admin) {
    throw new Error(`signer ${signer.address} is NOT DEFAULT_ADMIN_ROLE on proxy`)
  }
  console.log(`admin check: true`)

  const tx = await p.upgradeTo(newImpl)
  console.log(`upgradeTo tx: ${tx.hash}`)
  const rc = await tx.wait()
  console.log(`tx mined in block ${rc.blockNumber}, status ${rc.status}`)

  const erc1967 = await upgrades.erc1967.getImplementationAddress(proxy)
  console.log(`ERC1967 slot now: ${erc1967}`)
  if (erc1967.toLowerCase() !== newImpl.toLowerCase()) {
    throw new Error(`ERC1967 slot mismatch: expected ${newImpl}, got ${erc1967}`)
  }

  // Step 3: verify on block explorer.
  console.log(`Waiting 10s before verification…`)
  await new Promise((r) => setTimeout(r, 10000))
  try {
    await run('verify:verify', {
      address: newImpl,
      contract: 'contracts/modules/CrowdfundingModule.sol:CrowdfundingModule'
    })
    console.log(`Verified.`)
  } catch (e: any) {
    console.log(`Verification issue: ${e?.message || e}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
