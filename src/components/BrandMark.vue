<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { settings } from '@/stores/settings'

const { t } = useI18n()
</script>

<template>
  <div class="flex items-baseline gap-2 select-none">
    <!-- زمام in Aref Ruqaa, as outlines: some browsers drop the dot of the ز when they draw the font. The dot is drawn
    as a ring in lapis, as in the logo. The box ends on the baseline, so it lines up with the name beside it, and the
    tail of the م hangs below. -->
    <svg
      viewBox="3 -687 1467 687"
      class="h-[0.687em] w-[1.467em] shrink-0 overflow-visible text-[28px] text-highlighted"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M475 -468Q477 -478 474.5 -489Q472 -500 458 -501Q431 -504 401 -506.5Q371 -509 354 -494Q347 -488 342 -482Q337 -476 330 -464Q323 -452 312 -428Q301 -404 281 -361L211 -343Q156 -328 113 -309.5Q70 -291 44 -252Q25 -210 14 -158.5Q3 -107 3 -52Q4 21 15.5 88Q27 155 42 221.5Q57 288 66 358Q78 316 82 262Q86 208 80 159L38 -102Q33 -134 51 -150.5Q69 -167 88 -177Q121 -195 159.5 -205.5Q198 -216 237.5 -227Q277 -238 309 -254Q357 -279 389.5 -305.5Q422 -332 442.5 -370.5Q463 -409 475 -468ZM578 -570 617 0 679 -118 641 -687ZM813 -165Q731 -140 639 -129L617 0Q684 -16 742.5 -31Q801 -46 856 -74Q918 -105 947 -140Q966 -163 976 -178Q986 -193 992.5 -213Q999 -233 1006 -270Q1014 -308 967 -309Q919 -311 902 -305Q876 -305 851 -250Q838 -222 829 -200.5Q820 -179 813 -165ZM1470 -272Q1469 -277 1464 -277.5Q1459 -278 1457 -272Q1433 -219 1388 -189Q1340 -157 1282.5 -135Q1225 -113 1164 -94Q1093 -72 1059.5 -56.5Q1026 -41 1022.5 -30.5Q1019 -20 1039 -14Q1059 -8 1096 -4.5Q1133 -1 1180 0Q1256 2 1307.5 -21Q1359 -44 1393 -84Q1409 -103 1424 -134.5Q1439 -166 1451.5 -202.5Q1464 -239 1470 -272Z"
      />
      <circle cx="1384.5" cy="-445.5" r="58" fill="none" stroke="currentColor" stroke-width="44" class="text-primary" />
    </svg>
    <span v-if="settings.locale === 'en'" class="text-base leading-none font-medium text-highlighted" aria-hidden="true"
      >Zimam</span
    >
    <span class="sr-only">{{ t('app.name') }}</span>
  </div>
</template>
