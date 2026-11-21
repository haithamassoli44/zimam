<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { useI18n } from 'vue-i18n'

import { submitViewDialog, viewDialog } from '@/stores/view'

const { t } = useI18n()
</script>

<template>
  <UModal v-model:open="viewDialog.open" :title="viewDialog.viewId ? t('views.renameTitle') : t('views.saveTitle')">
    <template #body>
      <form id="view-form" @submit.prevent="submitViewDialog">
        <UFormField :label="t('views.name')">
          <UInput v-model="viewDialog.name" :placeholder="t('views.namePlaceholder')" autofocus class="w-full" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :label="t('setup.cancel')" @click="viewDialog.open = false" />
        <UButton
          type="submit"
          form="view-form"
          color="neutral"
          :disabled="!viewDialog.name.trim()"
          :label="t('views.saveButton')"
        />
      </div>
    </template>
  </UModal>
</template>
