// Major Indian cities: a central (usually GPO / head office) pincode and city-centre coordinates.
// Big cities usually have warehouses nearby, so they are the best bet when your pincode isn't served.
import { distanceKm } from "../lib/geo";
import { prefixLocation } from "./pin-prefix";

export type City = { city: string; pin: number; lat: number; lng: number };

const RAW: [city: string, pin: number, lat: number, lng: number][] = [
  ["Mumbai", 400001, 18.94, 72.835], ["Thane", 400601, 19.197, 72.963], ["Navi Mumbai", 400703, 19.033, 73.03],
  ["Delhi", 110001, 28.632, 77.219], ["Noida", 201301, 28.535, 77.391], ["Gurugram", 122001, 28.459, 77.027],
  ["Ghaziabad", 201001, 28.669, 77.454], ["Faridabad", 121001, 28.408, 77.318], ["Bengaluru", 560001, 12.976, 77.603],
  ["Hyderabad", 500001, 17.385, 78.487], ["Chennai", 600001, 13.083, 80.283], ["Kolkata", 700001, 22.572, 88.364],
  ["Pune", 411001, 18.52, 73.857], ["Ahmedabad", 380001, 23.026, 72.587], ["Surat", 395003, 21.17, 72.831],
  ["Vadodara", 390001, 22.307, 73.181], ["Rajkot", 360001, 22.304, 70.802], ["Jaipur", 302001, 26.912, 75.787],
  ["Jodhpur", 342001, 26.238, 73.024], ["Udaipur", 313001, 24.585, 73.712], ["Kota", 324001, 25.213, 75.865],
  ["Lucknow", 226001, 26.847, 80.947], ["Kanpur", 208001, 26.449, 80.332], ["Agra", 282001, 27.177, 78.008],
  ["Varanasi", 221001, 25.318, 82.974], ["Prayagraj", 211001, 25.435, 81.846], ["Meerut", 250001, 28.984, 77.706],
  ["Nagpur", 440001, 21.146, 79.088], ["Nashik", 422001, 19.998, 73.79], ["Aurangabad", 431001, 19.876, 75.343],
  ["Indore", 452001, 22.72, 75.858], ["Bhopal", 462001, 23.26, 77.413], ["Gwalior", 474001, 26.218, 78.183],
  ["Jabalpur", 482001, 23.181, 79.987], ["Raipur", 492001, 21.251, 81.63], ["Patna", 800001, 25.594, 85.138],
  ["Ranchi", 834001, 23.344, 85.31], ["Jamshedpur", 831001, 22.805, 86.203], ["Dhanbad", 826001, 23.796, 86.43],
  ["Bhubaneswar", 751001, 20.296, 85.825], ["Cuttack", 753001, 20.463, 85.883], ["Guwahati", 781001, 26.144, 91.736],
  ["Siliguri", 734001, 26.727, 88.395], ["Durgapur", 713201, 23.52, 87.312], ["Chandigarh", 160017, 30.733, 76.779],
  ["Ludhiana", 141001, 30.901, 75.857], ["Amritsar", 143001, 31.634, 74.872], ["Jammu", 180001, 32.727, 74.857],
  ["Srinagar", 190001, 34.084, 74.797], ["Shimla", 171001, 31.105, 77.173], ["Dehradun", 248001, 30.317, 78.032],
  ["Coimbatore", 641001, 11.017, 76.956], ["Madurai", 625001, 9.925, 78.12], ["Tiruchirappalli", 620001, 10.791, 78.705],
  ["Salem", 636001, 11.664, 78.146], ["Puducherry", 605001, 11.934, 79.83], ["Kochi", 682011, 9.98, 76.28],
  ["Thiruvananthapuram", 695001, 8.524, 76.937], ["Kozhikode", 673001, 11.259, 75.78], ["Thrissur", 680001, 10.527, 76.214],
  ["Mysuru", 570001, 12.296, 76.639], ["Mangaluru", 575001, 12.914, 74.856], ["Hubballi", 580020, 15.365, 75.124],
  ["Belagavi", 590001, 15.85, 74.498], ["Visakhapatnam", 530001, 17.687, 83.218], ["Vijayawada", 520001, 16.506, 80.648],
  ["Panaji", 403001, 15.49, 73.827], ["Shillong", 793001, 25.578, 91.893], ["Imphal", 795001, 24.817, 93.937],
  ["Agartala", 799001, 23.831, 91.287], ["Gangtok", 737101, 27.339, 88.607], ["Aizawl", 796001, 23.727, 92.718],
  ["Kohima", 797001, 25.675, 94.11], ["Itanagar", 791111, 27.084, 93.605], ["Port Blair", 744101, 11.623, 92.726],

  // Tier-2 / Tier-3 cities
  // Maharashtra
  ["Solapur", 413001, 17.659, 75.906], ["Latur", 413512, 18.408, 76.56], ["Kolhapur", 416001, 16.705, 74.243],
  ["Sangli", 416416, 16.852, 74.581], ["Amravati", 444601, 20.937, 77.779], ["Akola", 444001, 20.702, 77.008],
  ["Nanded", 431601, 19.138, 77.321], ["Kalyan", 421301, 19.243, 73.135], ["Vasai", 401201, 19.391, 72.839],
  ["Jalgaon", 425001, 21.004, 75.563], ["Ahmednagar", 414001, 19.095, 74.749],
  // Gujarat
  ["Gandhinagar", 382010, 23.223, 72.65], ["Bhavnagar", 364001, 21.765, 72.152], ["Jamnagar", 361001, 22.47, 70.058],
  ["Junagadh", 362001, 21.522, 70.457], ["Anand", 388001, 22.556, 72.951], ["Bhuj", 370001, 23.242, 69.667],
  // Rajasthan
  ["Ajmer", 305001, 26.45, 74.64], ["Bikaner", 334001, 28.022, 73.312], ["Alwar", 301001, 27.553, 76.635],
  ["Sikar", 332001, 27.61, 75.14],
  // Uttar Pradesh / Uttarakhand
  ["Greater Noida", 201310, 28.474, 77.504], ["Aligarh", 202001, 27.897, 78.088], ["Mathura", 281001, 27.492, 77.674],
  ["Bareilly", 243001, 28.367, 79.432], ["Moradabad", 244001, 28.839, 78.774], ["Saharanpur", 247001, 29.968, 77.546],
  ["Gorakhpur", 273001, 26.76, 83.373], ["Jhansi", 284001, 25.449, 78.569], ["Haridwar", 249401, 29.946, 78.164],
  ["Haldwani", 263139, 29.219, 79.513],
  // Madhya Pradesh / Chhattisgarh
  ["Ujjain", 456001, 23.182, 75.777], ["Sagar", 470001, 23.838, 78.738], ["Rewa", 486001, 24.531, 81.296],
  ["Satna", 485001, 24.58, 80.833], ["Bhilai", 490001, 21.194, 81.38], ["Bilaspur", 495001, 22.079, 82.139],
  // Bihar / Jharkhand
  ["Gaya", 823001, 24.796, 85.008], ["Bhagalpur", 812001, 25.244, 86.972], ["Muzaffarpur", 842001, 26.121, 85.391],
  ["Darbhanga", 846004, 26.152, 85.897], ["Bokaro", 827001, 23.669, 86.151], ["Hazaribagh", 825301, 23.992, 85.361],
  // West Bengal / Odisha
  ["Howrah", 711101, 22.586, 88.31], ["Asansol", 713301, 23.683, 86.983], ["Bardhaman", 713101, 23.232, 87.863],
  ["Kharagpur", 721301, 22.346, 87.232], ["Rourkela", 769001, 22.26, 84.854], ["Sambalpur", 768001, 21.467, 83.976],
  ["Berhampur", 760001, 19.315, 84.792],
  // Punjab / Haryana
  ["Jalandhar", 144001, 31.326, 75.576], ["Patiala", 147001, 30.34, 76.386], ["Bathinda", 151001, 30.211, 74.945],
  ["Mohali", 160055, 30.704, 76.718], ["Panchkula", 134109, 30.695, 76.854], ["Ambala", 133001, 30.378, 76.777],
  ["Karnal", 132001, 29.686, 76.99], ["Panipat", 132103, 29.391, 76.964], ["Sonipat", 131001, 28.994, 77.019],
  ["Rohtak", 124001, 28.895, 76.607], ["Hisar", 125001, 29.149, 75.722],
  // Andhra Pradesh / Telangana
  ["Guntur", 522001, 16.307, 80.437], ["Nellore", 524001, 14.443, 79.987], ["Tirupati", 517501, 13.629, 79.419],
  ["Kurnool", 518001, 15.828, 78.037], ["Anantapur", 515001, 14.682, 77.601], ["Rajahmundry", 533101, 17.0, 81.804],
  ["Kakinada", 533001, 16.989, 82.247], ["Warangal", 506002, 17.968, 79.594], ["Karimnagar", 505001, 18.439, 79.129],
  ["Nizamabad", 503001, 18.672, 78.094],
  // Tamil Nadu
  ["Vellore", 632001, 12.916, 79.132], ["Hosur", 635109, 12.74, 77.825], ["Erode", 638001, 11.341, 77.717],
  ["Tiruppur", 641601, 11.108, 77.341], ["Thanjavur", 613001, 10.787, 79.138], ["Tirunelveli", 627001, 8.713, 77.757],
  ["Thoothukudi", 628001, 8.764, 78.135],
  // Kerala / Karnataka / Goa
  ["Kollam", 691001, 8.893, 76.614], ["Kottayam", 686001, 9.592, 76.522], ["Palakkad", 678001, 10.787, 76.654],
  ["Kannur", 670001, 11.874, 75.37], ["Udupi", 576101, 13.341, 74.747], ["Tumakuru", 572101, 13.34, 77.101],
  ["Shivamogga", 577201, 13.93, 75.568], ["Davanagere", 577001, 14.464, 75.921], ["Ballari", 583101, 15.139, 76.921],
  ["Kalaburagi", 585101, 17.329, 76.834], ["Vijayapura", 586101, 16.83, 75.71], ["Margao", 403601, 15.274, 73.958],
  // North-East, Himalayas, UTs
  ["Dibrugarh", 786001, 27.472, 94.912], ["Jorhat", 785001, 26.757, 94.203], ["Tezpur", 784001, 26.633, 92.8],
  ["Silchar", 788001, 24.833, 92.779], ["Dharamshala", 176215, 32.219, 76.323], ["Mandi", 175001, 31.708, 76.932],
  ["Leh", 194101, 34.153, 77.577], ["Daman", 396210, 20.397, 72.832], ["Silvassa", 396230, 20.274, 73.008],
];

export const MAJOR_CITIES: City[] = RAW.map(([city, pin, lat, lng]) => ({ city, pin, lat, lng }));

const byPin = new Map(MAJOR_CITIES.map((c) => [c.pin, c]));

export function nearestCity(lat: number, lng: number): City {
  let best = MAJOR_CITIES[0]!;
  let bestD = Infinity;
  for (const c of MAJOR_CITIES) {
    const d = distanceKm(lat, lng, c.lat, c.lng);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/**
 * Approximate location of any pincode: a city's own pincode is exact; otherwise the centre of
 * its 3-digit pincode area; as a last resort, the city sharing the longest pincode prefix.
 */
export function approxLocation(pin: number): { lat: number; lng: number } | null {
  const city = byPin.get(pin);
  if (city) return city;
  const area = prefixLocation(pin);
  if (area) return area;
  const s = String(pin);
  for (const len of [2, 1]) {
    const matches = MAJOR_CITIES.filter((c) => String(c.pin).startsWith(s.slice(0, len)));
    if (matches.length) return matches.reduce((a, b) => (Math.abs(b.pin - pin) < Math.abs(a.pin - pin) ? b : a));
  }
  return null;
}

/** The major city nearest to a pincode, for labels like "near Pune". */
export function approxCity(pin: number): City | null {
  const loc = approxLocation(pin);
  return loc ? nearestCity(loc.lat, loc.lng) : null;
}
