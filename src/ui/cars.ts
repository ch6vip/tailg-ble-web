import type { CarInfo } from '../cloud/types'

function buildCarInfoText(car: CarInfo): string {
  const defence = car.defenceStatus === 1 ? '已设防' : '已解防'
  const acc = car.acc === 1 ? '已上电' : '已断电'
  return `IMEI: ${car.imei} | ${defence} | ${acc} | 电量: ${car.electricQuantity ?? '-'}%`
}

export function renderCarList(cars: CarInfo[], onSelect: (car: CarInfo) => void) {
  const container = document.getElementById('car-list')
  if (!container) return
  container.innerHTML = ''
  if (!cars.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-note'
    empty.textContent = '当前账号暂无车辆，请确认手机号绑定车辆后重试。'
    container.appendChild(empty)
    return
  }
  for (const car of cars) {
    const div = document.createElement('div')
    div.className = 'car-item'
    div.dataset.imei = car.imei
    const name = document.createElement('div')
    name.className = 'car-name'
    name.textContent = car.carNickName || car.carName || car.btname || car.imei
    const info = document.createElement('div')
    info.className = 'car-info'
    info.textContent = buildCarInfoText(car)
    div.append(name, info)
    div.addEventListener('click', () => onSelect(car))
    container.appendChild(div)
  }
}

export function selectCarUI(car: CarInfo): { defence: string; power: string } {
  const title = document.getElementById('vehicle-title')
  if (title) title.textContent = car.carNickName || car.carName || car.btname || '台铃智控车'
  document.querySelectorAll('.car-item').forEach(el => el.classList.remove('selected'))
  document.querySelectorAll('.car-item').forEach(el => {
    if ((el as HTMLElement).dataset.imei === car.imei) el.classList.add('selected')
  })

  const defence = car.defenceStatus === 1 ? '已设防' : '已解防'
  const power = car.acc === 1 ? '已上电' : '已断电'

  const heroVoltage = document.getElementById('hero-voltage-val')
  if (heroVoltage) heroVoltage.textContent = car.voltage != null ? `${car.voltage}V` : '--V'

  const heroBatteryVal = document.getElementById('hero-battery-val')
  if (heroBatteryVal) {
    heroBatteryVal.textContent = car.electricQuantity != null ? `${car.electricQuantity}%` : '--%'
  }
  const fillBar = document.getElementById('battery-fill-bar')
  if (fillBar && car.electricQuantity != null) {
    const pct = Math.min(100, Math.max(0, Number(car.electricQuantity)))
    fillBar.setAttribute('width', String(Math.round(pct * 0.2)))
  }

  const heroMileage = document.getElementById('hero-mileage-val')
  if (heroMileage) {
    heroMileage.textContent = car.mileage != null ? `预估 ${car.mileage} km` : ''
  }

  const defenceText = document.getElementById('hero-defence-text')
  const powerText = document.getElementById('hero-power-text')
  if (defenceText) defenceText.textContent = defence
  if (powerText) powerText.textContent = power

  return { defence, power }
}
