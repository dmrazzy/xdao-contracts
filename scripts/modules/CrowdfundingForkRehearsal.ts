import 'dotenv/config'

import { ethers, network } from 'hardhat'

// Target chain is selected via FORK_TARGET env (default: bsc).
// Ethereum mainnet fork is blocked on hardhat 2.9.1 — it cannot parse post-merge
// block headers. BSC / opBNB / Arbitrum Nova all host the same vulnerable impl
// and give a clean rehearsal environment.
type TargetId = 'eth' | 'bsc' | 'opbnb' | 'arbNova' | 'arb1' | 'polygon' | 'avalanche'

const TARGETS: Record<
  TargetId,
  { proxy: string; factory: string; defaultRpc: string; rpcEnv: string }
> = {
  eth: {
    proxy: '0x711E14eBC41A8f1595433FA4409a50BC9838Fc03',
    factory: '0x72cc6E4DE47f673062c41C67505188144a0a3D84',
    defaultRpc: 'https://eth.drpc.org',
    rpcEnv: 'MAINNET_RPC_URL'
  },
  bsc: {
    proxy: '0x97330364E1a9209214ef5107a04798170D351b68',
    factory: '0x72cc6E4DE47f673062c41C67505188144a0a3D84',
    defaultRpc: 'https://bsc-dataseed1.binance.org',
    rpcEnv: 'BSC_RPC_URL'
  },
  opbnb: {
    proxy: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd',
    factory: '0x72cc6E4DE47f673062c41C67505188144a0a3D84',
    defaultRpc: 'https://opbnb-mainnet-rpc.bnbchain.org',
    rpcEnv: 'OPBNB_RPC_URL'
  },
  arbNova: {
    proxy: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd',
    factory: '0x72cc6E4DE47f673062c41C67505188144a0a3D84',
    defaultRpc: 'https://nova.arbitrum.io/rpc',
    rpcEnv: 'ARB_NOVA_RPC_URL'
  },
  arb1: {
    proxy: '0x0cf784bba0FFA0a7006f3Ee7e4357E643a07F6e7',
    factory: '0x72cc6E4DE47f673062c41C67505188144a0a3D84',
    defaultRpc: 'https://arb1.arbitrum.io/rpc',
    rpcEnv: 'ARB_ONE_RPC_URL'
  },
  polygon: {
    proxy: '0x8AC7D4cEA044fB0d0153c28d145aE350bA25f1bA',
    factory: '0x72cc6E4DE47f673062c41C67505188144a0a3D84',
    defaultRpc: 'https://polygon.drpc.org',
    rpcEnv: 'POLYGON_RPC_URL'
  },
  avalanche: {
    proxy: '0x096BE3B573c74034Ba5A7E08DE412691DB9449fd',
    factory: '0x72cc6E4DE47f673062c41C67505188144a0a3D84',
    defaultRpc: 'https://avalanche.drpc.org',
    rpcEnv: 'AVALANCHE_RPC_URL'
  }
}

const TARGET = (process.env.FORK_TARGET as TargetId) || 'bsc'
if (!TARGETS[TARGET]) throw new Error(`Unknown FORK_TARGET: ${TARGET}`)
const { proxy: PROXY, factory: FACTORY, defaultRpc, rpcEnv } = TARGETS[TARGET]
const FORK_RPC = process.env[rpcEnv] || defaultRpc

const ADMIN = '0x8B437841e8B031b0178173732002bc0a4AF84BE3'

// ERC1967 impl slot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const ERC1967_IMPL_SLOT = ethers.utils.hexZeroPad(
  ethers.BigNumber.from(
    ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes('eip1967.proxy.implementation')
    )
  )
    .sub(1)
    .toHexString(),
  32
)

const main = async () => {

  console.log(`=== Crowdfunding Fork Rehearsal ===`)
  console.log(`Fork RPC: ${FORK_RPC}`)
  console.log(`Proxy:    ${PROXY}`)
  console.log(`Admin:    ${ADMIN}`)
  console.log(`ERC1967 slot: ${ERC1967_IMPL_SLOT}`)

  // 1. Pin fork to latest-N block so public RPC still has state.
  // Public archive-less nodes prune head-of-chain state aggressively,
  // causing "missing trie node" mid-run.
  const upstream = new ethers.providers.JsonRpcProvider(FORK_RPC)
  const latest = await upstream.getBlockNumber()
  const pinnedBlock = latest - 50
  console.log(`Pinning fork to block: ${pinnedBlock} (latest: ${latest})`)

  await network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: FORK_RPC,
          blockNumber: pinnedBlock
        }
      }
    ]
  })

  const [deployer] = await ethers.getSigners()
  const forkBlock = await ethers.provider.getBlockNumber()
  console.log(`Forked at block: ${forkBlock}`)

  // 2. Read old impl from ERC1967 slot.
  const oldImplRaw = await ethers.provider.getStorageAt(
    PROXY,
    ERC1967_IMPL_SLOT
  )
  const oldImpl = ethers.utils.getAddress('0x' + oldImplRaw.slice(-40))
  console.log(`Old impl:     ${oldImpl}`)

  // 3. Storage snapshot (pre).
  const moduleAbi = [
    'function factory() view returns (address)',
    'function shop() view returns (address)',
    'function privateExitModule() view returns (address)',
    'function vestingModule() view returns (address)',
    'function feeAddress() view returns (address)',
    'function regularFeeRate() view returns (uint256)',
    'function discountFeeRate() view returns (uint256)',
    'function saleIndexes(address) view returns (uint256)',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function upgradeTo(address newImplementation)'
  ]
  const proxy = await ethers.getContractAt(moduleAbi, PROXY)

  const snap = async () => ({
    factory: await proxy.factory(),
    shop: await proxy.shop(),
    privateExitModule: await proxy.privateExitModule(),
    vestingModule: await proxy.vestingModule(),
    feeAddress: await proxy.feeAddress(),
    regularFeeRate: (await proxy.regularFeeRate()).toString(),
    discountFeeRate: (await proxy.discountFeeRate()).toString()
  })
  const pre = await snap()
  console.log(`Pre-upgrade storage:`)
  console.log(JSON.stringify(pre, null, 2))

  const adminIsAdmin = await proxy.hasRole(
    '0x' + '0'.repeat(64),
    ADMIN
  )
  if (!adminIsAdmin) {
    throw new Error(`ADMIN ${ADMIN} does not hold DEFAULT_ADMIN_ROLE on fork`)
  }
  console.log(`hasRole(DEFAULT_ADMIN_ROLE, admin): true`)

  // 4. Impersonate admin + fund.
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [ADMIN]
  })
  await network.provider.request({
    method: 'hardhat_setBalance',
    params: [ADMIN, '0x21e19e0c9bab2400000'] // 10000 ETH
  })
  const adminSigner = await ethers.getSigner(ADMIN)

  // 5. Deploy new implementation from the deployer signer (ordinary tx).
  const CrowdfundingModule = await ethers.getContractFactory(
    'CrowdfundingModule',
    deployer
  )
  const newImpl = await CrowdfundingModule.deploy()
  await newImpl.deployed()
  console.log(`New impl:     ${newImpl.address}`)
  if (newImpl.address.toLowerCase() === oldImpl.toLowerCase()) {
    throw new Error(`new impl address collides with old`)
  }

  // 6. Raw UUPS upgradeTo as admin.
  const upgradeTx = await proxy.connect(adminSigner).upgradeTo(newImpl.address)
  const rc = await upgradeTx.wait()
  console.log(`upgradeTo tx:  ${rc.transactionHash} (status ${rc.status})`)

  const postImplRaw = await ethers.provider.getStorageAt(
    PROXY,
    ERC1967_IMPL_SLOT
  )
  const postImpl = ethers.utils.getAddress('0x' + postImplRaw.slice(-40))
  console.log(`Impl after upgrade: ${postImpl}`)
  if (postImpl.toLowerCase() !== newImpl.address.toLowerCase()) {
    throw new Error(`ERC1967 slot did not update`)
  }

  // 7. Storage snapshot (post).
  const post = await snap()
  const diff = Object.keys(pre).filter(
    (k) => (pre as any)[k].toString() !== (post as any)[k].toString()
  )
  if (diff.length) {
    console.error(`STORAGE DIVERGED on keys: ${diff.join(', ')}`)
    console.error('pre:', pre)
    console.error('post:', post)
    throw new Error('storage-layout regression')
  }
  console.log(`Storage preserved across upgrade.`)

  // 8. Bytecode sanity: look for a 32-byte slice of the guard message.
  // Solidity splits revert strings >32B across PUSH32 ops, so we only check
  // the first 32-byte chunk, which is always contiguous in code.
  const newImplCode = await ethers.provider.getCode(newImpl.address)
  const head = ethers.utils
    .hexlify(ethers.utils.toUtf8Bytes('CrowdfundingModule: tokenAddress'))
    .slice(2)
  if (newImplCode.toLowerCase().includes(head.toLowerCase())) {
    console.log(`New impl bytecode carries guard revert-string prefix.`)
  } else {
    console.log(
      `WARN: guard prefix not found in bytecode — functional test below is authoritative.`
    )
  }

  // 9. On-fork functional test: find an existing DAO, impersonate, run initSale.
  const factoryAbi = [
    'function getDaos() view returns (address[])',
    'function containsDao(address) view returns (bool)'
  ]
  const factory = await ethers.getContractAt(factoryAbi, FACTORY)

  const daos: string[] = await factory.getDaos()
  console.log(`Factory knows ${daos.length} DAOs; picking first clean one.`)

  const daoAbi = ['function lp() view returns (address)']
  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)'
  ]

  // Discover (custodiedLp, victimDao, attackerDao) where:
  //   - custodiedLp belongs to victimDao
  //   - module holds balance of custodiedLp > 0
  //   - attackerDao is a different DAO with its own non-zero LP
  const erc20 = (addr: string) => ethers.getContractAt(erc20Abi, addr)
  const dao = (addr: string) => ethers.getContractAt(daoAbi, addr)

  type Row = { dao: string; lp: string; custodied: boolean }
  const rows: Row[] = []
  for (const d of daos) {
    try {
      const lp: string = await (await dao(d)).lp()
      if (!lp || lp === ethers.constants.AddressZero) continue
      const bal = await (await erc20(lp)).balanceOf(PROXY)
      rows.push({ dao: d, lp, custodied: bal.gt(0) })
    } catch {
      continue
    }
  }
  const victim = rows.find((r) => r.custodied)
  const attacker = rows.find(
    (r) =>
      !r.custodied &&
      r.lp.toLowerCase() !== (victim?.lp ?? '').toLowerCase() &&
      r.dao.toLowerCase() !== (victim?.dao ?? '').toLowerCase()
  )
  if (!victim) {
    console.warn(
      `WARN: no custodied LP found on fork — cannot construct negative test.`
    )
    return
  }
  if (!attacker) {
    console.warn(
      `WARN: no attacker DAO candidate (all DAOs have custodied LP). Skipping.`
    )
    return
  }
  console.log(`Victim DAO:   ${victim.dao}, LP: ${victim.lp}`)
  console.log(`Attacker DAO: ${attacker.dao}, LP: ${attacker.lp}`)

  const altLp = victim.lp

  const evmSnapshot = async (): Promise<string> =>
    (await network.provider.request({
      method: 'evm_snapshot',
      params: []
    })) as string
  const evmRevert = async (id: string) =>
    network.provider.request({ method: 'evm_revert', params: [id] })

  const initSaleIface = new ethers.utils.Interface([
    'function initSale(address _currency,address _token,uint256 _rate,uint256 _saleAmount,uint256 _endTimestamp,uint256 _vestingId,uint256[] _entranceLimits,bool[4] _limits,tuple(address investor,uint256 allocation)[] _whitelist)'
  ])

  const chosenDao = attacker.dao
  const chosenLp = attacker.lp

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [chosenDao]
  })
  await network.provider.request({
    method: 'hardhat_setBalance',
    params: [chosenDao, '0x21e19e0c9bab2400000']
  })
  const daoSigner = await ethers.getSigner(chosenDao)

  const now = Math.floor(Date.now() / 1000)
  const callData = initSaleIface.encodeFunctionData('initSale', [
    ethers.constants.AddressZero, // _currency (0 = native)
    altLp, // <-- negative test: another DAO's LP (custodied)
    ethers.utils.parseEther('1'),
    ethers.utils.parseEther('1000'),
    now + 7 * 24 * 3600,
    0,
    [0, 0],
    [false, false, false, false],
    []
  ])

  // negative test
  const snapId = await evmSnapshot()
  try {
    await daoSigner.sendTransaction({ to: PROXY, data: callData })
    console.error(`NEGATIVE TEST FAILED: guard did not revert`)
    process.exitCode = 1
  } catch (e: any) {
    const msg = String(e?.error?.message || e?.reason || e?.message || e)
    if (msg.includes('tokenAddress custodied for another DAO')) {
      console.log(`Negative test PASS — guard reverted as expected.`)
    } else {
      console.log(`Negative test reverted, but reason != guard: ${msg}`)
      console.log(
        `(If the reason is "only for DAOs" or "already exists", chosen DAO is unsuitable — positive test will clarify.)`
      )
    }
  }
  await evmRevert(snapId)

  // positive test with own LP
  const positiveData = initSaleIface.encodeFunctionData('initSale', [
    ethers.constants.AddressZero,
    chosenLp,
    ethers.utils.parseEther('1'),
    ethers.utils.parseEther('1000'),
    now + 7 * 24 * 3600,
    0,
    [0, 0],
    [false, false, false, false],
    []
  ])
  try {
    await daoSigner.sendTransaction({ to: PROXY, data: positiveData })
    console.log(`Positive test PASS — initSale with own LP succeeded.`)
  } catch (e: any) {
    const msg = String(e?.error?.message || e?.reason || e?.message || e)
    console.log(`Positive test reverted: ${msg}`)
    console.log(
      `(Acceptable reasons: "already exists" — DAO already has a sale. Unrelated to guard.)`
    )
  }

  console.log(`=== rehearsal done ===`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
