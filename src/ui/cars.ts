import { $ } from '../dom'
import type { CarInfo } from '../cloud/types'

function buildCarInfoText(car: CarInfo): string {
  const defence = car.defenceStatus === '1' ? '已设防' : '已解防'
  const acc = car.acc === '1' ? '已上电' : '已断电'
  return `IMEI: ${car.imei} | ${defence} | ${acc} | 电量: ${car.electricQuantity || '-'}%`
}

export function renderCarList(cars: CarInfo[], onSelect: (car: CarInfo) => void) {
  const container = $('car-list')
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
    name.textContent = car.carName || car.btname || car.imei
    const info = document.createElement('div')
    info.className = 'car-info'
    info.textContent = buildCarInfoText(car)
    div.append(name, info)
    div.addEventListener('click', () => onSelect(car))
    container.appendChild(div)
  }
}

export function selectCarUI(car: CarInfo) {
  const title = document.getElementById('vehicle-title')
  if (title) title.textContent = car.carName || car.btname || '台铃智控车'
  document.querySelectorAll('.car-item').forEach(el => el.classList.remove('selected'))
  document.querySelectorAll('.car-item').forEach(el => {
    if ((el as HTMLElement).dataset.imei === car.imei) el.classList.add('selected')
  })
  $('lock-state').textContent = car.defenceStatus === '1' ? '已设防' : '已解防'
  $('power-state').textContent = car.acc === '1' ? '已上电' : '已断电'
  $('battery-val').textContent = car.electricQuantity ? `${car.electricQuantity}%` : '-'
  $('voltage-val').textContent = car.voltage ? `${car.voltage}V` : '-'
}
