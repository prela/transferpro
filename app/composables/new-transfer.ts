/**
 * The frame's "+ Novi transfer" asks the Transfers page to open the form.
 * The request is a counter so a second click on the same page still opens it.
 */
export function useNewTransferRequest() {
  const nonce = useState('new-transfer-nonce', () => 0)
  const route = useRoute()

  async function requestNewTransfer() {
    if (route.path !== '/transfers')
      await navigateTo('/transfers')
    nonce.value += 1
  }

  return { nonce, requestNewTransfer }
}
