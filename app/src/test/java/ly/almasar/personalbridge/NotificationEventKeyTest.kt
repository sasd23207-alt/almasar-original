package ly.almasar.personalbridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class NotificationEventKeyTest {
    @Test fun sameNotificationProducesSameId() {
        val first = NotificationEventKey.create("key", "merchant", 1234L, "حولت 300 دينار")
        val second = NotificationEventKey.create("key", "merchant", 1234L, "حولت 300 دينار")
        assertEquals(first, second)
    }

    @Test fun timestampParticipatesInDeduplicationKey() {
        val first = NotificationEventKey.create("key", "merchant", 1234L, "حولت 300 دينار")
        val second = NotificationEventKey.create("key", "merchant", 1235L, "حولت 300 دينار")
        assertNotEquals(first, second)
    }

    @Test fun senderAndBodyParticipateInDeduplicationKey() {
        val base = NotificationEventKey.create("key", "merchant", 1234L, "حولت 300 دينار")
        assertNotEquals(base, NotificationEventKey.create("key", "other", 1234L, "حولت 300 دينار"))
        assertNotEquals(base, NotificationEventKey.create("key", "merchant", 1234L, "حولت 500 دينار"))
    }
}
