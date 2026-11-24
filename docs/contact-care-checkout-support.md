# Checkout hold and support queue

- In the voucher picker, a verified active payment remains on hold. Only a visible, selected hold is checked automatically, at most three times. Unverified states stop the automatic wait; support can be requested when there is a blocking checkout record.
- Provider-confirmed expiry or abort only retires the matching unapproved local checkout under the existing compare-and-set rules. A blank, missing, mismatched or unavailable provider response never clears the hold. A status check or support request never redeems a voucher, opens a payment, cancels a provider payment or reveals a contact.
- The member receives a support reference, not a payment identifier. Repeated requests reuse that reference. If staff already marked it checked, the UI says so without promising a new request. Admins can open the reference to view a bounded list of relevant order numbers and states. Marking it checked changes only the support ticket.
- The home 1:1 shortcut uses existing match state and navigation. It offers an exchanged-contact shortcut only for an approved, visible existing result. Recommendation badges are based on an unambiguous shared municipality in existing profile data; they do not change recommendation or quota rules.

Apply `supabase/sql/contact_care_checkout_support.sql` before deploying this app change. The migration adds a private table and two service-only functions and does not modify existing match, order, voucher or disclosure records.
