// 2026 Horse Year
export var ZODIAC_NAMES = ["鼠","牛","虎","兔","龙","蛇","马","羊","猴","鸡","狗","猪"];
export var ZODIAC_NUMBERS = [[7,19,31,43],[6,18,30,42],[5,17,29,41],[4,16,28,40],[3,15,27,39],[2,14,26,38],[1,13,25,37,49],[12,24,36,48],[11,23,35,47],[10,22,34,46],[9,21,33,45],[8,20,32,44]];

export var NUMBER_TO_ZODIAC = {};
export var ZODIAC_TO_NUMBERS = {};
for (var i = 0; i < ZODIAC_NAMES.length; i++) {
  ZODIAC_TO_NUMBERS[ZODIAC_NAMES[i]] = ZODIAC_NUMBERS[i];
  for (var j = 0; j < ZODIAC_NUMBERS[i].length; j++) {
    NUMBER_TO_ZODIAC[ZODIAC_NUMBERS[i][j]] = ZODIAC_NAMES[i];
  }
}

export var RED = [1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46];
export var BLUE = [3,4,9,10,14,15,20,25,26,31,36,37,41,42,47,48];
export var GREEN = [5,6,11,16,17,21,22,27,28,32,33,38,39,43,44,49];

export function getZodiac(n) { return NUMBER_TO_ZODIAC[n] || "?"; }
export function getNumbers(z) { return ZODIAC_TO_NUMBERS[z] || []; }
export function getSize(z) { return (ZODIAC_TO_NUMBERS[z] || []).length; }
export function getColor(n) {
  if (RED.indexOf(n) >= 0) return "red";
  if (BLUE.indexOf(n) >= 0) return "blue";
  return "green";
}
export function pad(n) { return ("0" + n).slice(-2); }
