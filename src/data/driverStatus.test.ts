import { describe, expect, it } from 'vitest'
import { applyDriverFallback, applyFleetFallback } from './fallbacks'
import {
  mapDriverRowToData,
  mapVehicleToFleetAsset,
  resolveAssignedDriverDisplayName,
  UNASSIGNED_DRIVER_LABEL,
} from './mappers'

describe('mapDriverRowToData', () => {
  it('maps remote name and merges optional driver_pii', () => {
    const result = mapDriverRowToData(
      {
        name: 'Mari Ots',
        expiry_date: '01/01/2030',
      },
      {
        personal_code: '49001010000',
        license_number: 'EE-B0000001',
      },
    )

    expect(result.fullName).toBe('Mari Ots')
    expect(result.personalCode).toBe('49001010000')
    expect(result.licenseNumber).toBe('EE-B0000001')
    expect(result.expiryDate).toBe('01/01/2030')
  })

  it('uses unavailable markers when driver_pii is missing', () => {
    const result = mapDriverRowToData({
      name: 'Mari Ots',
      expiry_date: '01/01/2030',
    })

    expect(result.personalCode).toBe('—')
    expect(result.licenseNumber).toBe('—')
  })

  it('assigns REGISTRY RECORD and never VERIFIED & REGISTERED', () => {
    const result = mapDriverRowToData(
      {
        name: 'Mari Ots',
        status: 'VERIFIED & REGISTERED',
      },
      { personal_code: '49001010000' },
    )

    expect(result.status).toBe('REGISTRY RECORD')
    expect(result.status).not.toBe('VERIFIED & REGISTERED')
  })
})

describe('resolveAssignedDriverDisplayName', () => {
  it('returns Unassigned when assigned_driver_id is null', () => {
    expect(resolveAssignedDriverDisplayName(null, 'Jürgen Tamm')).toBe(
      UNASSIGNED_DRIVER_LABEL,
    )
    expect(resolveAssignedDriverDisplayName(undefined, 'Mari Ots')).toBe(
      UNASSIGNED_DRIVER_LABEL,
    )
  })

  it('returns resolved drivers.name only when assigned_driver_id is set', () => {
    expect(
      resolveAssignedDriverDisplayName('cf96b4cf-910b-4452-93ce-22085077977c', 'Mari Ots'),
    ).toBe('Mari Ots')
  })
})

describe('mapVehicleToFleetAsset', () => {
  it('ignores denormalized driver_name when assigned_driver_id is null', () => {
    const result = mapVehicleToFleetAsset({
      asset_id: 'EE-FLEET-991',
      assigned_driver_id: null,
      driver_name: 'Jürgen Tamm',
      speed: '84 km/h',
      battery: '72% Electric EV',
      compliance_tier: 'OPTIMAL CLEARANCE',
    })

    expect(result.driverName).toBe(UNASSIGNED_DRIVER_LABEL)
    expect(result.driverName).not.toBe('Jürgen Tamm')
    expect(result.energy).toBe('72% Electric EV')
    expect(result.batteryPercent).toBe(72)
  })

  it('uses assigned driver name when assigned_driver_id is present', () => {
    const result = mapVehicleToFleetAsset(
      {
        asset_id: 'EE-FLEET-402',
        assigned_driver_id: 'cf96b4cf-910b-4452-93ce-22085077977c',
        driver_name: 'Should Not Appear',
        battery: '91% Electric EV',
        compliance_tier: 'DOCK CHARGING',
      },
      'Mari Ots',
    )

    expect(result.driverName).toBe('Mari Ots')
    expect(result.driverName).not.toBe('Should Not Appear')
  })

  it('maps remote compliance_tier into statusLabel and clearance status', () => {
    const optimal = mapVehicleToFleetAsset({
      asset_id: 'EE-FLEET-991',
      assigned_driver_id: null,
      battery: '72% Electric EV',
      compliance_tier: 'OPTIMAL CLEARANCE',
    })
    const critical = mapVehicleToFleetAsset({
      asset_id: 'EE-FLEET-118',
      assigned_driver_id: null,
      battery: '44% Diesel Engine',
      compliance_tier: 'CRITICAL WARNING',
    })
    const docking = mapVehicleToFleetAsset({
      asset_id: 'EE-FLEET-402',
      assigned_driver_id: null,
      battery: '91% Electric EV',
      compliance_tier: 'DOCK CHARGING',
    })

    expect(optimal.statusLabel).toBe('OPTIMAL CLEARANCE')
    expect(optimal.status).toBe('optimal')
    expect(critical.statusLabel).toBe('CRITICAL WARNING')
    expect(critical.status).toBe('critical')
    expect(docking.statusLabel).toBe('DOCK CHARGING')
    expect(docking.status).toBe('docking')
  })
})

describe('applyFleetFallback', () => {
  it('keeps three demo vehicles without presenting fallback names as assignments', () => {
    const result = applyFleetFallback(mapVehicleToFleetAsset)

    expect(result).toHaveLength(3)
    expect(result.map((v) => v.assetId)).toEqual([
      'EE-FLEET-991',
      'EE-FLEET-402',
      'EE-FLEET-118',
    ])
    expect(result.every((v) => v.driverName === UNASSIGNED_DRIVER_LABEL)).toBe(true)
  })
})

describe('applyDriverFallback', () => {
  it('assigns a demo status without implying verification', () => {
    const result = applyDriverFallback()

    expect(result.status).toBe('DEMO RECORD')
  })
})
