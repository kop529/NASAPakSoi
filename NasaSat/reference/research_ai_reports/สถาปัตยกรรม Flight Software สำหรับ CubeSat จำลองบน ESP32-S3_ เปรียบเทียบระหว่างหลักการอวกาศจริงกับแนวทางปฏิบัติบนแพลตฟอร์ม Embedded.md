# สถาปัตยกรรม Flight Software สำหรับ CubeSat จำลองบน ESP32-S3: เปรียบเทียบระหว่างหลักการอวกาศจริงกับแนวทางปฏิบัติบนแพลตฟอร์ม Embedded

## การออกแบบสถาปัตยกรรมซอฟต์แวร์แบบ Layered และ Finite State Machine

การออกแบบสถาปัตยกรรมซอฟต์แวร์สำหรับ On-Board Computer (OBC) ของ CubeSat จำลองบนไมโครคอนโทรลเลอร์ ESP32-S3 ต้องอาศัยกรอบการทำงานที่แข็งแกร่ง โปร่งใส และสามารถบำรุงรักษาได้ง่าย โดยเน้นที่การแยกความกังวลออกจากกันเพื่อลดความซับซ้อนและเพิ่มความน่าเชื่อถือ <user> เป้าหมายหลักคือการสร้างระบบที่สามารถทำงานได้อย่างสม่ำเสมอภายใต้ข้อจำกัดทางฮาร์ดแวร์ของ ESP32-S3 ซึ่งแตกต่างจากสภาพแวดล้อมในวงการอวกาศจริงที่มีความทนทานสูงมาก <user> แนวทางที่ได้รับการยอมรับในวงการอวกาศ เช่น สถาปัตยกรรม Core Flight System (cFS) ซึ่งเป็นเฟรมเวิร์กที่ออกแบบมาเพื่อการนำกลับมาใช้ใหม่ (reusability) และการปรับเปลี่ยนได้ (portability) [[1](https://etd.gsfc.nasa.gov/capabilities/core-flight-system/), [33](https://etd.gsfc.nasa.gov/capabilities/capabilities-listing/cfs/)] ประกอบด้วยชั้นหลายชั้น เช่น Platform Support Package (PSP), Operating System Abstraction Layer (OSAL), และ Core Flight Executive (CFE) [[33](https://etd.gsfc.nasa.gov/capabilities/capabilities-listing/cfs/)] อย่างไรก็ตาม สำหรับโครงการจำลองบนโต๊ะ การนำไปใช้โดยตรงอาจซับซ้อนเกินไปและมี Overhead สูงเกินความจำเป็น <user> ดังนั้น แนวทางที่เหมาะสมคือการนำหลักการแบบ Layered Architecture มาปรับใช้ให้เหมาะกับสภาพแวดล้อมของ ESP-IDF และ FreeRTOS ซึ่งเป็น RTOS ที่มีอยู่แล้วบน ESP32 [[3](https://github.com/spel-uchile/SUCHAI-Flight-Software)]

สถาปัตยกรรมแบบ Layered สำหรับ OBC จำลองนี้สามารถแบ่งออกได้เป็นสามชั้นหลัก ชั้นแรกคือ Hardware Abstraction Layer (HAL) ซึ่งทำหน้าที่เป็นสะพานเชื่อมระหว่างโค้ดแอปพลิเคชันกับฮาร์ดแวร์จริง <user> ชั้นนี้จะครอบคลุม ESP-IDF drivers ทั้งหมด เช่น UART driver สำหรับการสื่อสาร, ADC driver สำหรับการแปลงสัญญาณ, และ SPI/I2C drivers สำหรับการควบคุมเซนเซอร์หรือ actuator <URLRT6YPG> การสร้าง HAL จะช่วยให้โค้ดในชั้นถัดไปไม่ต้องพึ่งพารายละเอียดเฉพาะของฮาร์ดแวร์ และสามารถทดสอบได้ง่ายขึ้นในสภาพแวดล้อมจำลอง (Simulation Environment) ชั้นที่สองคือ Service/Task Layer ซึ่งเป็นแกนกลางของการทำงานของระบบ <user> ในชั้นนี้ แต่ละหน่วยวิชาชีพจะถูกแทนที่ด้วย FreeRTOS Task ที่ทำงานขนานกันได้ [[31](https://controllerstech.com/esp32-freertos-multitasking-project/)] ตัวอย่างเช่น มี Task สำหรับการอ่านข้อมูลจาก ADC, Task สำหรับการประมวลผลคำสั่งจากภาคพื้นดิน, Task สำหรับการรวบรวมข้อมูล Housekeeping, และ Task สำหรับการควบคุม Payload (Sun Tracking และ Target Imaging) ตรรกะการสื่อสารระหว่าง Tasks ควรใช้ Primitive ของ FreeRTOS เช่น Queues และ Semaphores แทนการเรียก Function ตรงๆ เพื่อลดความผูกพัน (coupling) และเพิ่มความยืดหยุ่น <user>[[29](https://kennypeng.com/2023/07/21/esp32_fluid_sim_1.html)] ชั้นที่สามคือ Application Logic หรือ State Machine Layer ซึ่งจะรวบรวมตรรกะทั้งหมดของภารกิจเข้าไว้ด้วยกัน โดยมี Finite State Machine (FSM) เป็นตัวควบคุมการทำงานหลักของระบบ <user>[[37](https://digitalcommons.usu.edu/smallsat/2023/all2023/55/)] ในชั้นนี้จะมีตรรกะสำหรับการเปลี่ยนสถานะระหว่างโหมดการทำงานต่างๆ เช่น Detumble, Safe, Nominal, Payload และ Recovery ตามลำดับที่กำหนด

การจัดการโหมดการทำงานของ CubeSat จำลองจะดำเนินการผ่าน Finite State Machine (FSM) ที่มีสถานะหลัก ๆ ดังนี้: `Detumble`, `Safe`, `Nominal`, `Payload`, และ `Recovery` <user> FSM นี้จะทำหน้าที่เป็นเครื่องควบคุมศูนย์กลางที่กำหนดพฤติกรรมของระบบในแต่ละสถานะ และกำหนดกฎเกณฑ์สำหรับการเปลี่ยนจากสถานะหนึ่งไปยังอีกสถานะหนึ่ง

| สถานะ | คำอธิบาย | เงื่อนไขการเปลี่ยนสถานะ (Transition Conditions) |
| :--- | :--- | :--- |
| **Detumble** | สถานะแรกที่เกิดขึ้นหลังการปล่อยดาวเทียม (launch) จุดประสงค์หลักคือการลดความเร็วในการหมุนของ CubeSat ลงให้อยู่ในระดับที่ควบคุมได้ โดยอาจใช้ Actuator อย่าง Reaction Wheel หรือ Magnetorquer หากมี <user>[[37](https://digitalcommons.usu.edu/smallsat/2023/all2023/55/)] | `if (attitude_stabilized && power_system_stable)` → `Safe`<br>`if (critical_failure_detected)` → `Recovery` |
| **Safe Mode** | สถานะสำรองที่ใช้เมื่อเกิดข้อผิดพลาดร้ายแรง (major fault) หรือไม่สามารถดำเนินการตามลำดับ Nominal procedure ได้ <user> หน้าที่หลักคือการรักษาสถานะของดาวเทียมให้มั่นคง (e.g., ควบคุมทิศทางให้ชี้ดวงอาทิตย์, รักษาพลังงาน, และสื่อสารกับภาคพื้นดิน) | `if (all_critical_systems_recovered)` → `Nominal`<br>`if (payload_operation_successful)` → `Nominal`<br>`if (persistent_error_detected)` → `Recovery` |
| **Nominal Mode** | สถานะการทำงานปกติของระบบ OBC และระบบย่อยอื่น ๆ ตามแผนภารกิจที่กำหนด <user> ทุกฟังก์ชันทำงานตามปกติและประสิทธิภาพสูงสุด | `if (mission_duration_expired)` → `Safe`<br>`if (non-critical_fault_detected)` → `Safe`<br>`if (payload_activation_requested)` → `Payload` |
| **Payload Mode** | สถานะที่เปิดใช้งานหน่วยงานบรรทุกภารกิจ (Sun Tracking และ Target Imaging) <user> อาจมีความต้องการทรัพยากรสูง (CPU, พลังงาน) ซึ่งอาจทำให้ระบบย่อยอื่นบางอย่างถูกระงับ Temporarily | `if (payload_operation_complete)` → `Nominal`<br>`if (power_constraint_violated)` → `Safe`<br>`if (critical_failure_detected)` → `Recovery` |
| **Recovery Mode** | สถานะที่ใช้สำหรับพยายามฟื้นฟูระบบกลับสู่สถานะที่มีเสถียรภาพ (e.g., `Safe` หรือ `Nominal`) จากข้อผิดพลาดที่เกิดขึ้น <user>[[37](https://digitalcommons.usu.edu/smallsat/2023/all2023/55/)] อาจรวมถึงการ reset ฮาร์ดแวร์, การ re-initialize ไดรเวอร์, หรือการ execute sequence การกู้คืนที่กำหนดไว้ล่วงหน้า | `if (recovery_sequence_completed_successfully)` → `Safe`<br>`if (recovery_attempt_failed_permanently)` → `Safe` |

การเปลี่ยนสถานะระหว่างแต่ละโหมดต้องผ่าน Guard Condition ที่เข้มงวดและตรวจสอบซ้ำเพื่อป้องกันการเปลี่ยนสถานะที่ไม่คาดคิดและเพิ่มความน่าเชื่อถือให้กับระบบ <user> ตัวอย่างเช่น การเปลี่ยนจาก `Detumble` ไปยัง `Safe` ไม่ควรเกิดขึ้นเพียงแค่เวลาผ่านไป แต่ต้องรอจนกระทั่งเซนเซอร์ตรวจพบว่าท่าทิศทางได้ถูกควบคุมและระบบพลังงานมีเสถียรภาพแล้วเท่านั้น การออกแบบ FSM ที่มีตรรกะการเปลี่ยนสถานะที่ชัดเจนนี้ แม้จะเป็นการ simplified จาก FDIR ที่ซับซ้อนในดาวเทียมจริงตามมาตรฐาน ECSS [[13](https://innovationspace.ansys.com/knowledge/forums/topic/an-introduction-to-space-software-standards-ecss-e-st-40-and-ecss-q-st-80c/)] แต่ก็ยังคงรักษาหลักการ fundamental ของ robust software design ไว้ได้อย่างครบถ้วน ซึ่งเป็นสิ่งจำเป็นอย่างยิ่งสำหรับโครงการจำลองระดับการศึกษาหรือการแข่งขันที่ต้องการผลลัพธ์ที่น่าเชื่อถือ

**ข้อควรระวัง (Caution):**
1.  **Avoid Direct Function Calls:** การสื่อสารระหว่าง Tasks ควรหลีกเลี่ยงการเรียกฟังก์ชันโดยตรง (Direct Call) เนื่องจากจะสร้างความผูกพันที่แน่นแฟ้นระหว่าง Tasks และทำให้ยากต่อการปรับเปลี่ยนหรือนำกลับมาใช้ใหม่ <user> ควรใช้ Message Queues ของ FreeRTOS สำหรับการส่งข้อมูลขนาดใหญ่หรือข้อมูลที่ไม่ต่อเนื่อง และใช้ Binary Semaphores หรือ Task Notifications สำหรับการแจ้งเตือนและประสานงาน (Synchronization) [[29](https://kennypeng.com/2023/07/21/esp32_fluid_sim_1.html), [31](https://controllerstech.com/esp32-freertos-multitasking-project/)]
2.  **State Transition Integrity:** การเปลี่ยนสถานะต้องทำอย่างปลอดภัย ควรมี Critical Section หรือ Mutex เพื่อป้องกันการเปลี่ยนสถานะพร้อมกันโดย Task ที่แตกต่างกัน ซึ่งอาจทำให้ state variable ของ FSM กลายเป็นสถานะที่ไม่คาดคิด [[30](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/freertos_idf.html), [31](https://controllerstech.com/esp32-freertos-multitasking-project/)]
3.  **Default State Handling:** FSM ควรจะมี Default State หรือ Error State ที่ชัดเจนสำหรับกรณีที่ encounter สถานะหรือ transition ที่ไม่ได้นิยามไว้ เพื่อป้องกัน system from entering an undefined or unrecoverable state.
4.  **Guard Condition Complexity:** แม้จะเป็นการ simplified แต่ Guard Conditions ควรจะถูกตรวจสอบใน Task ที่มีความสำคัญสูงสุดหรือใน Context ที่สามารถเข้าถึงข้อมูลจากเซนเซอร์และระบบย่อยทั้งหมดได้อย่างรวดเร็วและแม่นยำ

## การจัดการเวลาและการสั่งงานแบบ Real-time บน ESP-IDF

ความสามารถในการทำงานแบบ real-time เป็นหัวใจสำคัญของ Flight Software สำหรับ CubeSat เพราะภารกิจต่างๆ เช่น การควบคุมท่าทิศทาง (ADCS) และการถ่ายภาพ (Payload) ต้องตอบสนองต่อเหตุการณ์ภายในระยะเวลาที่แน่นอน <user> การพัฒนาระบบ real-time บน ESP32-S3 ซึ่งใช้ ESP-IDF ที่มี FreeRTOS เป็น RTOS หลัก ต้องพิจารณาทั้งทฤษฎีและข้อจำกัดทางปฏิบัติ [[31](https://controllerstech.com/esp32-freertos-multitasking-project/)] ทฤษฎีในวงการอวกาศมักใช้ Fixed-priority preemptive scheduling ซึ่งเป็นรูปแบบที่ใช้กันทั่วไปใน RTOS สมัยใหม่ [[29](https://kennypeng.com/2023/07/21/esp32_fluid_sim_1.html)] สำหรับ ESP-IDF บน ESP32-S3 นั้น ได้รับการปรับปรุงให้รองรับ Symmetric Multiprocessing (SMP) ซึ่งหมายความว่ามีสอง core ที่ทำงานได้พร้อมกันและสามารถสั่งการ tasks ได้แบบ preemptive บน core แต่ละตัว [[22](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/freertos_idf.html), [30](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/freertos_idf.html)] อย่างไรก็ตาม การบรรลุ deterministic performance บนฮาร์ดแวร์แบบ dual-core ที่มี multitasking ทั้ง Wi-Fi, Bluetooth และ application logic ที่หลากหลาย ต้องอาศัยเทคนิคการออกแบบที่รอบคอบ [[23](https://gizantech.com/blog/esp32-real-time-control-industrial-automation)]

**ทฤษฎี: Cooperative vs Preemptive Scheduling**
ในระบบ multitasking มีสองรูปแบบหลักของการสั่งงาน:
1.  **Cooperative Scheduling:** ในรูปแบบนี้ แต่ละ task จะต้องทำการ "yield" หรือปล่อยให้ scheduler มอบหมาย CPU ให้กับ task อื่นโดยตั้งใจ ถ้า task ใด task หนึ่งไม่ยอม yield หรือตกอยู่ใน infinite loop นาน task ที่มีความสำคัญสูงกว่าก็จะไม่มีโอกาสได้รับ CPU ซึ่งทำให้ระบบสูญเสีย responsiveness [[19](https://freertos.org/FreeRTOS_Support_Forum_Archive/December_2017/freertos_FreeRTOS_High_Tick_Rate_for_Machine_Control_8d87a77fj.html)] รูปแบบนี้ไม่เหมาะสมกับงาน real-time ที่ต้องการการตอบสนองที่รวดเร็วและคาดเดาได้
2.  **Preemptive Scheduling:** นี่คือรูปแบบที่ใช้ใน ESP-IDF [[29](https://kennypeng.com/2023/07/21/esp32_fluid_sim_1.html)] ในรูปแบบนี้ OS จะหยุด task ที่กำลังทำงานอยู่ (preempt) ได้ทุกเมื่อหากมี task อื่นที่มีความสำคัญสูงกว่า (higher priority) เข้าสู่สถานะ ready ซึ่งหมายความว่า task ที่มีความสำคัญสูงสุดจะได้รับการบริการโดยเร็วที่สุดเสมอ ทำให้ระบบมี responsiveness สูงมาก อย่างไรก็ตาม ปัญหาที่อาจเกิดขึ้นคือ "starvation" ซึ่งเป็นกรณีที่ task ที่มีความสำคัญต่ำสุดอาจไม่มีโอกาสได้รับ CPU ไปตลอดกาลถ้า task ที่มีความสำคัญสูงกว่าไม่เคยหยุดทำงาน [[29](https://kennypeng.com/2023/07/21/esp32_fluid_sim_1.html)] ปัญหานี้สามารถจัดการได้ด้วยการใช้ synchronization primitives อย่างถูกต้อง เช่น mutexes

**ทฤษฎี: Rate-Monotonic Scheduling (RMS)**
RMS เป็น static-priority assignment algorithm ที่ใช้ในระบบ real-time ซึ่งกำหนดให้ period ของการทำงานที่สั้นที่สุด (high frequency) จะได้รับ priority สูงสุด [[31](https://controllerstech.com/esp32-freertos-multitasking-project/)] สมการสำหรับ RMS utilization bound test สำหรับ n tasks ที่มีการสั่งงานแบบ preemptive คือ:

$$ U_{total} = \sum_{i=1}^{n} \frac{C_i}{T_i} \le U_{bound}(n) = n(2^{1/n} - 1) $$

โดยที่:
*   $U_{total}$: คือ utilization รวมของ all tasks
*   $C_i$: คือ worst-case execution time ของ task i (หน่วย: วินาที)
*   $T_i$: คือ period หรือ interval ของการทำงานของ task i (หน่วย: วินาที)
*   $U_{bound}(n)$: คือ utilization bound factor สำหรับจำนวน task n

หากผลรวมของ utilization ทั้งหมด ($U_{total}$) น้อยกว่าหรือเท่ากับขอบเขตการใช้งาน ($U_{bound}(n)$) ระบบจะสามารถจัดการ schedule ได้อย่างแน่นอนโดยไม่มี deadline miss [[19](https://freertos.org/FreeRTOS_Support_Forum_Archive/December_2017/freertos_FreeRTOS_High_Tick_Rate_for_Machine_Control_8d87a77fj.html)] อย่างไรก็ตาม การใช้ RMS ในโครงการจำลองบน ESP32-S3 อาจซับซ้อนเกินความจำเป็น <user> ดังนั้น แนวทางที่แนะนำคือการใช้ fixed-priority preemptive scheduling ที่มีอยู่ใน FreeRTOS โดยให้ความสำคัญกับการกำหนด priority ที่เหมาะสมให้กับแต่ละ task ตามความสำคัญของงานที่ทำ [[29](https://kennypeng.com/2023/07/21/esp32_fluid_sim_1.html)]

**Pseudocode: การกำหนดคุณสมบัติของ Task ใน FreeRTOS**
```c
// ตัวอย่างการสร้าง Task ที่มีคุณสมบัติ (Affinity) และ Stack Size ที่กำหนดไว้ล่วงหน้า
void app_main(void) {
    // ...
    
    // สร้าง Task สำหรับ ADC Sampling ที่ต้องการ timing ที่แม่นยำ
    // พินning ไปยัง Core 1 เพื่อหลีกเลี่ยง jitter จาก Core 0
    xTaskCreatePinnedToCore(
        adc_sampling_task,
        "ADC_Sampler",
        2048,      // Stack size in words, not bytes!
        NULL,
        5,         // Priority level
        NULL,
        1          // Core affinity: 1 for APP_CPU (Core 1)
    );

    // สร้าง Task สำหรับการสื่อสารกับภาคพื้นดิน
    // ไม่ต้องการ core affinity ชัดเจน ปล่อยให้ scheduler จัดการ
    xTaskCreatePinnedToCore(
        communication_task,
        "Comm_Task",
        4096,      // Larger stack due to potential network operations
        NULL,
        3,         // Lower priority than critical tasks
        NULL,
        tskNO_AFFINITY // Unpinned task
    );
    
    // ...
}
```

**ทฤษฎี: Deterministic Timing และ High-Frequency Sampling**
สำหรับภารกิจเช่น Sun Tracking หรือ PID Control Loop ต้องการ sampling และ execution rate ที่สูงและสม่ำเสมอ (e.g., 1 kHz) [[23](https://gizantech.com/blog/esp32-real-time-control-industrial-automation)] การใช้ `vTaskDelay(pdMS_TO_TICKS(x))` เป็นวิธีที่ไม่เหมาะสมเพราะมี jitter สูงและขึ้นอยู่กับ FreeRTOS Tick Rate ที่ default คือ 1ms ซึ่งไม่เพียงพอสำหรับงานที่ต้องการความแม่นยำระดับไมโครวินาที [[20](https://community.simplefoc.com/t/has-anyone-tried-running-simplefoc-on-esp32-s3-with-multitasking/7455), [23](https://gizantech.com/blog/esp32-real-time-control-industrial-automation)] วิธีที่ถูกต้องและมีประสิทธิภาพสูงสุดคือการใช้ Hardware Timer Interrupts <URLRFPM> วิธีนี้ทำงานโดยการกำหนดค่า hardware timer ให้ trigger interrupt ในช่วงเวลาที่ต้องการ (e.g., 1kHz) ISR จะทำงานโดยไม่ต้องผ่าน context switch ของ RTOS และทำหน้าที่เพียงแค่ปลุก (wakeup) หรือส่ง notification ไปยัง high-priority task ที่ทำหน้าที่ควบคุมจริง [[19](https://freertos.org/FreeRTOS_Support_Forum_Archive/December_2017/freertos_FreeRTOS_High_Tick_Rate_for_Machine_Control_8d87a77fj.html), [21](https://forums.freertos.org/t/esp32-higher-loop-rate-than-1000hz/10215)] วิธีนี้ทำให้ main loop ของ task สามารถทำงานได้ตาม clock ที่สม่ำเสมอและแม่นยำโดยไม่ถูกรบกวนจากระบบ scheduler ที่ทำงานช้ากว่า

**Pseudocode: การใช้ Hardware Timer Interrupt สำหรับ High-Frequency Sampling**
```c
// Global variables
static const int TIMER_DIVIDER = 16; // ESP32 has an 80MHz timer clock
static const int TIMER_SCALE = (TIMER_BASE_CLK / TIMER_DIVIDER) / 1000000ULL; // Nanoseconds per tick
static const int TIMER_INTERVAL_MS = 1; // 1ms interval for 1kHz sampling
static hw_timer_t *timer = NULL;

// ISR ที่จะถูกเรียกเมื่อ timer หมดเวลา
void IRAM_ATTR onTimer() {
    // ปลุก (unblock) หรือส่ง notification ไปยัง task ที่ต้องการ
    xTaskNotifyGive(control_loop_task_handle); 
}

// ฟังก์ชันสำหรับ initial setup ของ timer
void timer_init() {
    // สร้างและตั้งค่า timer
    timer = timerBegin(0, TIMER_DIVIDER, true);
    timerAttachInterrupt(timer, &onTimer, true);
    timerAlarmWrite(timer, TIMER_INTERVAL_MS * TIMER_SCALE, true);
    timerAlarmEnable(timer);
}

// ใน task หลักที่ต้องการ run ทุก 1ms
void control_loop_task(void *pvParameters) {
    while(1) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY); // Block until notified by ISR
        // --- ตรรกะการควบคุมหลัก (e.g., PID calculation, motor control) ---
        // ตัวอย่าง: Read sensor, calculate output, write to actuator
        // ตรรกะนี้จะถูก execute ทุกๆ 1ms อย่างสม่ำเสมอ
    }
}
```

**ข้อควรระวัง:**
1.  **Stack Overflow:** การกำหนดขนาดของ stack สำหรับแต่ละ task ควรจะมีขนาดเพียงพอ ซึ่งสามารถตรวจสอบได้โดยใช้ฟังก์ชัน `uxTaskGetStackHighWaterMark()` [[31](https://controllerstech.com/esp32-freertos-multitasking-project/)] หน่วยความจำสแต็กที่เล็กเกินไปอาจทำให้เกิด `stack overflow` ซึ่งเป็นสาเหตุหนึ่งของ `Guru Meditation Error` บน ESP32 [[26](https://forum.arduino.cc/t/arduino-esp32-guru-meditation-error-stack-overflow/1313770)]
2.  **ISR Best Practices:** Interrupt Service Routines (ISR) บน ESP32 ควรจะสั้นและรวดเร็วที่สุดเท่าที่จะทำได้ <URLRFPM>[[21](https://forums.freertos.org/t/esp32-higher-loop-rate-than-1000hz/10215)] ไม่ควรทำการคำนวณที่ซับซ้อน, ไม่ควรใช้ `printf` หรือ `Serial.println` ภายใน ISR, และไม่ควรใช้ฟังก์ชันที่ blocking เช่น `vTaskDelay()` หรือ `malloc` <URLRFPM>[[43](https://zbotic.in/esp32-interrupt-driven-uart-high-speed-serial-communication/?srsltid=AfmBOopb31GFYr54LoF-tfSmxv1dZtu8Zt6ZJU0yGlLIkOFyefQvspAr)] หน้าที่หลักของ ISR คือการส่งข้อมูลเบื้องต้นไปยัง task ผ่าน queue หรือ semaphore แล้วจบลงทันที
3.  **Dual-Core Challenges:** เมื่อใช้ dual-core ต้องระมัดระวังเรื่อง shared resources อย่างยิ่ง การเข้าถึงตัวแปรหรือ peripheral ที่แบ่งปันระหว่างสอง core ต้องใช้ mechanism ที่เหมาะสม เช่น spinlocks (`portMUX_TYPE`) แทนการ disable interrupts ของ core เดียว [[22](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/freertos_idf.html), [30](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/freertos_idf.html)] การไม่ทำเช่นนี้อาจนำไปสู่ race condition ที่ทำให้ข้อมูลเสียหายได้
4.  **Power Management Interference:** คุณสมบัติประหยัดพลังงานของ FreeRTOS เช่น Tickless Idle หรือ Dynamic Frequency Scaling (DFS) อาจเพิ่ม latency ของ interrupt ได้ถึง 40 µs ซึ่งอาจทำลาย deterministic behavior ของระบบ real-time [[23](https://gizantech.com/blog/esp32-real-time-control-industrial-automation)] สำหรับ CubeSat จำลองที่เน้นความแม่นยำ ควรพิจารณาปิดคุณสมบัติเหล่านี้ออกไป
5.  **Tick Rate Rule of Thumb:** แม้ว่า FreeRTOS จะไม่มี hard limit สำหรับ tick rate แต่การตั้งค่าที่สูงเกินไป (e.g., >1kHz) อาจทำให้เกิด overhead จาก context switching ที่มากเกินไปและกิน CPU ไปกับ scheduler มากกว่าการทำงานจริง [[19](https://freertos.org/FreeRTOS_Support_Forum_Archive/December_2017/freertos_FreeRTOS_High_Tick_Rate_for_Machine_Control_8d87a77fj.html)] สำหรับการสั่งงานแบบ preemptive ที่มีการ time-slicing ควรหลีกเลี่ยงการตั้งค่า tick rate สูงเกิน 1 KHz [[19](https://freertos.org/FreeRTOS_Support_Forum_Archive/December_2017/freertos_FreeRTOS_High_Tick_Rate_for_Machine_Control_8d87a77fj.html)]

## ตรรกะการจัดการคำสั่งและข้อมูล (C&DH) ตามมาตรฐาน CCSDS

การจัดการคำสั่งและข้อมูล (C&DH) เป็นหนึ่งในหน้าที่หลักของ OBC ที่ทำหน้าที่เป็นศูนย์กลางในการรับส่งข้อมูลระหว่างภาคพื้นดินและระบบย่อยต่างๆ ภายใน CubeSat <user> ในโลกแห่งการบินอวกาศจริง การสื่อสารระหว่างยานอวกาศและภาคพื้นดินมีมาตรฐานที่เข้มงวดและเป็นสากลเพื่อให้มั่นใจถึงความเข้ากันได้และความน่าเชื่อถือ การมาตรฐานที่สำคัญที่สุดคือ Consultative Committee for Space Data Systems (CCSDS) ซึ่งเป็นองค์กรที่พัฒนาโปรโตคอลสำหรับการสื่อสารอวกาศ [[40](https://github.com/daniestevez/gr-satellites/blob/main/CCSDS_README.md), [41](https://parsimoni.co/blog/2026-04-15-reimplementing-the-space-protocol-stack-from-scratch)] สำหรับ CubeSat จำลองบน ESP32-S3 การนำแนวทางของ CCSDS มาปรับใช้แม้ในรูปแบบที่ simplified ก็ยังมีประโยชน์อย่างยิ่งในการสร้างประสบการณ์การเรียนรู้ที่ใกล้เคียงกับจริงและพัฒนาทักษะที่สามารถนำไปใช้ได้ในอนาคต <user> โปรโตคอลที่สำคัญที่สุดใน C&DH คือ Packet Utilisation Standard (PUS) หรือที่เรียกว่า CCSDS 133.0-B-2 ซึ่งนิยามโครงสร้างของ "Space Packet" ซึ่งเป็นหน่วยของข้อมูลที่ใช้ในระดับแอปพลิเคชัน [[41](https://parsimoni.co/blog/2026-04-15-reimplementing-the-space-protocol-stack-from-scratch), [46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)]

**ทฤษฎี: โครงสร้าง Packet ตาม CCSDS**
Packet ตามมาตรฐาน CCSDS ประกอบด้วย Primary Header ขนาด 6 octets (48 bits) และ Packet Data Field ที่มีขนาดเปลี่ยนแปลงได้ [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] โครงสร้างของ Packet คือ:

| Field | ขนาด (bit) | คำอธิบาย |
| :--- | :--- | :--- |
| **Packet Version Number** | 3 | เวอร์ชันของมาตรฐาน CCSDS (ต้องเป็น '000') [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] |
| **Packet Type** | 1 | ประเภทของ packet ('0' สำหรับ Telemetry, '1' สำหรับ Telecommand) [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] |
| **Secondary Header Flag** | 1 | แสดงว่ามี Secondary Header หรือไม่ ('0' ไม่มี, '1' มี) [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] |
| **APID (Application Process ID)** | 11 | รหัสประจำตัวของแอปพลิเคชันหรือ subsystem ที่ส่งหรือรับ packet [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] |
| **Sequence Flags** | 2 | สถานะของ packet ในการ segment (continuing, first, last, unsegmented) [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] |
| **Packet Sequence Count** | 14 | Counter ที่เพิ่มขึ้นทุกครั้งที่ส่ง packet ด้วย APID เดียวกัน [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] |
| **Packet Data Length** | 16 | ขนาดของ Packet Data Field (หน่วย: octet) [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] |

ขนาดของ Packet Data Field สามารถมีค่าตั้งแต่ 0 ถึง 65,535 octets ทำให้ขนาด packet ทั้งหมดสูงสุดคือ 65,541 octets [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] สำหรับการสื่อสารแบบ reliable บนยานอวกาศ โปรโตคอล PUS สนับสนุนการเพิ่ม CRC (Cyclic Redundancy Check) ลงใน trailer ของ packet เพื่อตรวจสอบความถูกต้องของข้อมูล (Error Control) [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)] การใช้ CRC-16/CCITT ซึ่งจะรวม header และ payload เข้าไปในการคำนวณ จะช่วยตรวจจับข้อผิดพลาดจากการส่งข้อมูลได้อย่างมีประสิทธิภาพ [[46](https://github.com/ExoSpaceLabs/CCSDSPack/blob/main/docs/CCSDS_133_0_B_2_PROFILE.md)]

**Pseudocode: การสร้างและวิเคราะห์ Packet ตาม CCSDS**
```c
// โครงสร้างข้อมูลสำหรับการสร้าง Packet
typedef struct {
    uint8_t version:3;
    uint8_t type:1;
    uint8_t sec_header_flag:1;
    uint16_t apid:11;
    uint8_t seq_flags:2;
    uint16_t seq_count:14;
    uint16_t data_length;
    uint8_t data_payload[256]; // สมมติว่าขนาด payload สูงสุด 256 bytes
    uint16_t crc; // สำหรับ CRC-16 trailer
} ccsds_packet_t;

// ฟังก์ชันสำหรับสร้าง Packet Telemetry
size_t build_telemetry_packet(uint8_t apid, const void* data, size_t len, uint8_t* output_buffer) {
    ccsds_packet_t* packet = (ccsds_packet_t*)output_buffer;
    
    // ตั้งค่า primary header fields
    packet->version = 0b000;
    packet->type = 0; // Telemetry
    packet->sec_header_flag = 0;
    packet->apid = apid & 0x7FF;
    packet->seq_flags = 0b11; // Unsegmented packet
    // seq_count ควรจะถูก update โดย manager ที่ดูแล APID นี้
    packet->data_length = len;
    
    // คัดลอก payload
    memcpy(packet->data_payload, data, len);
    
    // คำนวณและเพิ่ม CRC-16 trailer (สมมติว่า_CRC16 function มีอยู่)
    packet->crc = _CRC16(output_buffer, 6 + len); // คำนวณรวม header และ payload
    
    // คืนขนาด packet ทั้งหมด (รวม trailer)
    return 6 + len + 2;
}

// ฟังก์ชันสำหรับ validate และ parse packet
bool parse_telecommand_packet(const uint8_t* packet_buffer, size_t length, parsed_command_t* out_cmd) {
    if (length < 8) return false; // ต้องมี header (6) + CRC (2) อย่างน้อย
    
    const ccsds_packet_t* packet = (const ccsds_packet_t*)packet_buffer;
    
    // 1. ตรวจสอบ version number และ packet type
    if (packet->version != 0 || packet->type != 1) {
        return false; // ไม่ใช่ packet TC ที่ถูกต้อง
    }
    
    // 2. ตรวจสอบความถูกต้องของ CRC
    uint16_t calculated_crc = _CRC16(packet_buffer, length - 2);
    if (calculated_crc != *((uint16_t*)&packet_buffer[length - 2])) {
        return false; // CRC ไม่ถูกต้อง
    }
    
    // 3. ถ้าผ่านการ validate, copy ข้อมูลที่จำเป็น
    out_cmd->apid = packet->apid;
    out_cmd->data_length = packet->data_length;
    memcpy(out_cmd->data_payload, packet->data_payload, packet->data_length);
    
    return true;
}
```

**ทฤษฎี: การจัดการคำสั่ง**
การรับและดำเนินการคำสั่งจากภาคพื้นดิน (Telecommand Execution) ควรทำอย่างเป็นระบบและปลอดภัย <user> กระบวนการทำงานที่ดีคือ Queue-based Command Execution ซึ่งเป็นแนวทางที่ใช้ในเฟรมเวิร์กอย่าง SUCHAI Flight Software [[3](https://github.com/spel-uchile/SUCHAI-Flight-Software)] ตรรกะคือ:
1.  **Receive:** รับ packet จาก ground station ผ่าน interface เช่น UART หรือ Wireless [[42](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/uart.html)]
2.  **Validate:** ตรวจสอบ packet ตาม CCSDS standard (header, checksum) และ validate ต่อเนื่องด้วยการตรวจสอบ parameter ของคำสั่งเองว่าอยู่ใน range ที่ถูกต้องหรือไม่ (e.g., camera shutter speed ไม่ควรเป็นลบ)
3.  **Enqueue:** วางคำสั่งที่ผ่าน validation แล้วลงใน FreeRTOS queue ที่มีขนาดจำกัด
4.  **Execute:** มี task หลัก (command_executor_task) ที่ทำงานในลูปและคอยตรวจสอบ queue ทุก cycle หากมีคำสั่งรออยู่ ก็จะดึงคำสั่งนั้นออกมาและดำเนินการตามตรรกะที่เกี่ยวข้อง (e.g., เรียกฟังก์ชันสำหรับการถ่ายภาพ)

การใช้ queue เป็น buffer ชั่วคราวจะช่วยให้ระบบสามารถจัดการคำสั่งได้อย่างมีประสิทธิภาพ โดยไม่ต้อง block หรือ delay ในการรับคำสั่งใหม่จาก ground station ขณะที่กำลังดำเนินการคำสั่งก่อนหน้าอยู่

**Pseudocode: Queue-based Command Execution**
```c
// โครงสร้างสำหรับคำสั่ง
typedef struct {
    uint32_t timestamp; // Time-tagged command
    uint8_t apid;
    uint8_t cmd_id;
    uint8_t params[64];
    size_t param_len;
} command_t;

// FreeRTOS Queue Handle
QueueHandle_t xCommandQueue = NULL;

// Task สำหรับ executor
void command_executor_task(void *pvParameters) {
    command_t received_cmd;
    
    while(1) {
        // Block จนกว่าจะมีคำสั่งใน queue
        if (xQueueReceive(xCommandQueue, &received_cmd, portMAX_DELAY) == pdTRUE) {
            // --- ตรรกะการดำเนินการคำสั่ง ---
            // ตัวอย่าง: ตรวจสอบ cmd_id และเรียกฟังก์ชันที่เกี่ยวข้อง
            switch(received_cmd.cmd_id) {
                case CMD_ID_START_IMAGING:
                    start_target_imaging(received_cmd.params, received_cmd.param_len);
                    break;
                case CMD_ID_SET_SOLAR_ATTITUDE:
                    enable_sun_tracking();
                    break;
                // ... other commands
                default:
                    // Handle unknown command
                    break;
            }
        }
    }
}

// ฟังก์ชันที่ถูกเรียกจาก UART task เมื่อรับ packet สมบูรณ์
void handle_received_tc_packet(const uint8_t* packet_buf, size_t len) {
    command_t new_cmd;
    new_cmd.timestamp = get_current_time(); // สมมติว่ามีฟังก์ชันนี้
    
    // สมมติว่าฟังก์ชันนี้จะแยก APID, CMD ID, Params ออกจาก packet
    parse_telecommand_packet(packet_buf, len, &new_cmd.apid, &new_cmd.cmd_id, new_cmd.params, &new_cmd.param_len);
    
    // Enqueue command ไปยัง executor task
    // ใช้ xQueueSendToFront() เพื่อให้คำสั่งใหม่ที่เข้ามาดำเนินการก่อนคำสั่งที่อยู่ใน queue นานกว่า (priority)
    xQueueSendToFront(xCommandQueue, &new_cmd, 0);
}
```

**ข้อควรระวัง:**
1.  **UART Buffering:** การรับข้อมูลผ่าน UART ควรใช้ event-driven approach ที่มี ISR ช่วยจัดการ <URLT6YPG>[[43](https://zbotic.in/esp32-interrupt-driven-uart-high-speed-serial-communication/?srsltid=AfmBOopb31GFYr54LoF-tfSmxv1dZtu8Zt6ZJU0yGlLIkOFyefQvspAr)] การใช้ polling-based reading จะกิน CPU resources และมีความเสี่ยงสูงที่ข้อมูลจะหายไปจาก RX FIFO หากอ่านช้าเกินไป [[43](https://zbotic.in/esp32-interrupt-driven-uart-high-speed-serial-communication/?srsltid=AfmBOopb31GFYr54LoF-tfSmxv1dZtu8Zt6ZJU0yGlLIkOFyefQvspAr)] ESP-IDF UART driver สนับสนุน DMA (Direct Memory Access) ซึ่งเป็นวิธีที่มีประสิทธิภาพสูงสุดในการรับข้อมูลจำนวนมากโดยไม่ต้องใช้ CPU มากนัก <URLRT6YPG>
2.  **Queue Overflow:** ควรมีการจัดการกรณีที่ command queue ถึง capacity แล้ว อาจใช้ xQueueSend() แทน xQueueSendToFront() ซึ่งจะลบคำสั่งที่อยู่ใน queue นานที่สุดออกก่อนเพื่อให้คำสั่งใหม่เข้ามาได้ (Discard Oldest Policy) หรือส่ง telemetry กลับไปยัง ground station เพื่อแจ้งว่า system ยุ่ง
3.  **Time Tagging:** การเพิ่ม timestamp ให้กับคำสั่ง (time-tagged command) เป็นสิ่งสำคัญโดยเฉพาะสำหรับ mission ที่ต้องการการ sync ของ events อย่างแม่นยำ <user> ควรใช้ RTC (Real-Time Clock) หรือ high-resolution timer เพื่อให้ได้ timestamp ที่ถูกต้อง
4.  **Resource Contention:** เมื่อดำเนินการคำสั่งที่เปลี่ยนแปลง state ของระบบ (e.g., บังคับเปิดไฟ LED) ควรใช้ mutex เพื่อป้องกันการที่ task อื่นพยายามอ่าน state เดียวกันในขณะที่มันกำลังถูกอัปเดตอยู่ ซึ่งจะทำให้ได้ข้อมูลที่ไม่สมบูรณ์
5.  **Limited RAM:** CCSDS packets อาจมีขนาดใหญ่ได้ [[41](https://parsimoni.co/blog/2026-04-15-reimplementing-the-space-protocol-stack-from-scratch)] บน ESP32-S3 ที่มี SRAM ประมาณ 520KB [[11](https://www.scottyob.com/post/2025-02-27-esp32-memory/)] ควรตั้ง boundary สำหรับขนาด packet ที่ยอมรับได้ และมีกลไกในการจัดการ packet ที่ใหญ่เกินไป (e.g., discard หรือ request re-transmission) เพื่อป้องกัน heap exhaustion

## กลไกการตรวจจับ แยกส่วน และการกู้คืนข้อผิดพลาด (FDIR) ที่เหมาะสมกับแพลตฟอร์ม

กลไกการตรวจจับ แยกส่วน และการกู้คืนข้อผิดพลาด (FDIR) เป็นองค์ประกอบที่ขาดไม่ได้ของ Flight Software ที่มีความน่าเชื่อถือสูง โดยเฉพาะอย่างยิ่งในสภาพแวดล้อมที่ไม่สามารถเข้าถึงได้เหมือนในอวกาศ <user> ในวงการอวกาศจริง ระบบ FDIR มักจะซับซ้อนและมีหลายระดับตามมาตรฐาน ECSS-E-ST-40C ซึ่งกำหนดให้มีการประเมินความสำคัญของ software ตามความเสี่ยงที่อาจเกิดขึ้น (e.g., Category A, B, C, D) และกำหนดระเบียบปฏิบัติที่เข้มงวดตามนั้น [[13](https://innovationspace.ansys.com/knowledge/forums/topic/an-introduction-to-space-software-standards-ecss-e-st-40-and-ecss-q-st-80c/), [15](https://ldra.com/ecss-series/)] อย่างไรก็ตาม สำหรับ CubeSat จำลองบนโต๊ะ การ implement ที่สมบูรณ์แบบตาม ECSS อาจเกินความจำเป็นและซับซ้อนเกินไป <user> ดังนั้น แนวทางที่เหมาะสมคือการสร้างกลไก FDIR ที่เป็นรากฐานและมีประสิทธิภาพ ซึ่งสามารถตรวจจับข้อผิดพลาดทั่วไปและนำไปสู่การกู้คืนที่สามารถทำได้ด้วยตนเอง (autonomous recovery) ได้

**ทฤษฎี: ระดับของ Fault และ Autonomous Recovery**
ข้อผิดพลาดในระบบ embedded สามารถแบ่งออกได้เป็นหลายระดับ ตั้งแต่ข้อผิดพลาดที่เกิดจาก software (software faults) ไปจนถึงข้อผิดพลาดที่เกิดจากฮาร์ดแวร์ (hardware faults) <user> สำหรับ CubeSat จำลองบน ESP32-S3 กลไก FDIR ควรจะครอบคลุมข้อผิดพลาดที่พบบ่อยได้แก่:
1.  **Software Faults:** เช่น infinite loops, stack overflow, memory corruption
2.  **Hardware Faults:** เช่น ADC reading ที่ผิดปกติ, sensor disconnect, peripheral failure
3.  **System-Level Faults:** เช่น หมดพลังงาน, over-temperature, loss of communication

การกู้คืนแบบอัตโนมัติ (Autonomous Recovery) หมายถึงความสามารถของ OBC ที่จะตรวจพบข้อผิดพลาดและดำเนินการแก้ไขโดยไม่ต้องพึ่งพาคำสั่งจากภาคพื้นดิน <user> กลไกที่พบบ่อยได้แก่:
*   **Watchdog Timer (WDT):** เป็น mechanism ที่สำคัญที่สุดในการป้องกัน system lockup
    *   **Hardware Watchdog Timer (HW WDT):** ตั้งค่าให้ reset ฮาร์ดแวร์โดยตรงหาก kernel panic หรือ system crash เกิดขึ้น [[31](https://controllerstech.com/esp32-freertos-multitasking-project/)]
    *   **Task Watchdog Timer (TWDT):** ตั้งค่าให้ reset chip หาก task ใด task หนึ่ง block หรือ busy-wait นานเกินไปโดยไม่ได้ให้ CPU แก่ task อื่น ซึ่งมักเกิดจาก infinite loop หรือ deadlock [[31](https://controllerstech.com/esp32-freertos-multitasking-project/)]
*   **Stack Overflow Detection:** ESP-IDF มี built-in feature ที่สามารถตรวจสอบได้ว่า task ใด task หนึ่งใช้ stack มากกว่าที่กำหนดไว้หรือไม่ ซึ่งจะทำให้เกิด panic ทันที ช่วยป้องกัน stack corruption ที่อาจทำให้ system ล่มได้ [[26](https://forum.arduino.cc/t/arduino-esp32-guru-meditation-error-stack-overflow/1313770), [31](https://controllerstech.com/esp32-freertos-multitasking-project/)]
*   **Data Validation and Sanity Checks:** ตรวจสอบค่าที่ได้จากเซนเซอร์หรือจากคำสั่งจากภาคพื้นดินว่าอยู่ใน range ที่คาดว่าจะเป็นไปได้หรือไม่ <user> เช่น ADC reading ไม่ควรเป็นค่าติดลบหรือเกินค่า max ของ ADC
*   **Timeout Mechanisms:** สำหรับทุกการสื่อสารหรือ operation ที่คาดว่าจะใช้เวลา ควรจะมี timeout mechanism ที่จะยกเลิก operation และรายงาน error หากไม่สำเร็จภายในเวลาที่กำหนด

**Pseudocode: การกำหนดค่าและใช้งาน Watchdog Timer**
```c
// ฟังก์ชันสำหรับการ monitor สถานะ MQTT
void fmqttWatchDog(void *pvParameters) {
    const int maxNonMQTTresponse = 60; // 60 seconds
    int mqttOK_counter = 0;
    bool monitoring_active = true;

    while(monitoring_active) {
        vTaskDelay(pdMS_TO_TICKS(1000)); // ตรวจสอบทุกๆ 1 วินาที
        
        if (mqttOK_counter >= maxNonMQTTresponse) {
            // ไม่ได้รับ response จาก MQTT server เป็นเวลานาน
            ESP_LOGE("FDIR", "MQTT connection lost for %d seconds. Initiating recovery...", maxNonMQTTresponse);
            
            // --- กลไกการกู้คืน ---
            // 1. Disconnect from WiFi
            esp_wifi_stop();
            
            // 2. Wait a bit
            vTaskDelay(pdMS_TO_TICKS(2000));
            
            // 3. Restart the chip
            ESP_LOGI("FDIR", "Restarting device...");
            esp_restart();
        } else {
            // รีเซ็ต counter ถ้า receive response
            // สมมติว่ามี flag หรือ semaphore ที่จะถูก set เมื่อ receive response
            // xSemaphoreTake(mqtt_response_semaphore, 0); // ตรวจสอบโดยไม่ block
            // if (response_received) {
            //     mqttOK_counter = 0;
            // }
            // สำหรับตัวอย่างนี้ เราจะเพิ่ม counter แทน
            mqttOK_counter++;
        }
    }
}

// ใน app_main() หรือ initialization
void app_main(void) {
    // ...
    
    // สร้าง task สำหรับ monitoring WDT
    xTaskCreate(fmqttWatchDog, "FMQTT_WatchDog", 2048, NULL, 1, NULL);
    
    // ...
}
```

**ทฤษฎี: Safe Mode Entry Criteria**
Safe Mode คือสถานะที่ปลอดภัยที่สุดของระบบ ซึ่ง OBC จะพยายามเข้าสู่เมื่อตรวจพบข้อผิดพลาดที่ร้ายแรงหรือไม่สามารถดำเนินการต่อไปได้ <user> เงื่อนไขที่จะทำให้เข้าสู่ Safe Mode ควรจะชัดเจนและครอบคลุมสถานการณ์ที่เป็นไปได้ทั้งหมด ซึ่งสามารถรวมอยู่ใน Guard Conditions ของ FSM ได้
*   `if (twdt_triggered || hw_wdt_triggered)`: ระบบมีความผิดปกติอย่างรุนแรงหรือ lock up
*   `if (battery_voltage < min_safe_voltage)`: พลังงานไม่เพียงพอ
*   `if (internal_temperature > max_operating_temp)`: ระบบมีอุณหภูมิสูงเกินไป
*   `if (critical_component_failure_detected)`: เช่น I2C bus fail, sensor disconnect
*   `if (command_execution_timeout)`: คำสั่งจากภาคพื้นดินไม่สามารถดำเนินการได้
*   `if (invalid_state_in_FSM)`: FSM อยู่ในสถานะที่ไม่ถูกต้อง

เมื่อเข้าสู่ Safe Mode ฟังก์ชันหลักของ OBC จะต้องทำตามลำดับที่กำหนดไว้ล่วงหน้า เช่น ปิด payload ที่ไม่จำเป็น, รักษาการเชื่อมต่อแบบ low-power กับภาคพื้นดิน, และพยายามรักษาท่าทิศทางให้ชี้ดวงอาทิตย์เพื่อให้ EPS สามารถชาร์จแบตเตอรี่ได้

**Pseudocode: ตรรกะการเข้าสู่ Safe Mode**
```c
// Enum สำหรับสถานะของระบบ
typedef enum {
    SYS_OK,
    SYS_BATTERY_CRITICAL,
    SYS_TEMP_HIGH,
    SYS_PERIPHERAL_ERROR,
    SYS_TWD_TIMEOUT
} system_fault_status_t;

// ฟังก์ชันสำหรับตรวจสอบ health ของระบบ
system_fault_status_t check_system_health(void) {
    sensor_data_t battery_data = read_battery_sensor();
    float voltage = battery_data.voltage;
    float temperature = read_internal_temperature();
    
    if (voltage < 3.0) { // สมมติว่า 3.0V เป็นค่าต่ำสุด
        return SYS_BATTERY_CRITICAL;
    }
    if (temperature > 60.0) { // สมมติว่า 60°C เป็นค่าสูงสุด
        return SYS_TEMP_HIGH;
    }
    if (is_peripheral_working(I2C_PORT_0) == false) {
        return SYS_PERIPHERAL_ERROR;
    }
    
    return SYS_OK;
}

// ใน task หลักที่ทำหน้าที่เป็น heart-beat หรือ supervisor
void supervisor_task(void *pvParameters) {
    while(1) {
        vTaskDelay(pdMS_TO_TICKS(1000)); // ตรวจสอบทุกๆ 1 วินาที
        
        system_fault_status_t fault = check_system_health();
        
        if (fault != SYS_OK) {
            ESP_LOGW("Supervisor", "Critical fault detected: %d. Entering Safe Mode.", fault);
            
            // --- ตรรกะการกู้คืนข้อผิดพลาด ---
            // 1. หยุดการทำงานทั้งหมด
            stop_all_payload_operations();
            
            // 2. ปิดการใช้งาน peripherals ที่ไม่จำเป็น
            deinit_unused_peripherals();
            
            // 3. เปลี่ยน FSM state ไปยัง Safe Mode
            // สมมติว่ามีฟังก์ชันนี้ในการเปลี่ยนสถานะ
            enter_firmware_state(SAFE_MODE);
            
            // 4. ออกจาก task นี้ หรือ block forever
            break;
        }
    }
}
```

**ข้อควรระวัง:**
1.  **False Positives:** ควรตั้ง threshold สำหรับ sensor readings อย่างระมัดระวังเพื่อหลีกเลี่ยงการเข้าสู่ Safe Mode จาก noise หรือ transient spikes แทนที่จะเป็น fault ที่แท้จริง
2.  **Re-Entry Logic:** ควรมีตรรกะที่ชัดเจนสำหรับการออกจาก Safe Mode กลับสู่ Nominal Mode เช่น รอให้เงื่อนไขที่ทำให้เกิด fault นั้นกลับสู่ normal state และรออีกครั้งเพื่อให้แน่ใจว่า problem ไม่ได้กลับมาอีก
3.  **Logging:** ก่อนที่จะ restart หรือเข้าสู่ Safe Mode ควรพยายาม log ข้อมูล diagnostic ที่สำคัญที่สุดลงใน non-volatile storage (ถ้ามี) หรือส่งผ่าน telemetry เพื่อให้ ground team สามารถวิเคราะห์สาเหตุของข้อผิดพลาดได้
4.  **Resource Cleanup:** เมื่อเข้าสู่ Safe Mode หรือก่อน restart ควรพยายาม cleanup resources ให้มากที่สุดเท่าที่จะทำได้ เช่น ปิดการใช้งาน WiFi/BLE, ปิด peripheral ทั้งหมด เพื่อให้ system อยู่ในสถานะที่คาดเดาได้และพร้อมสำหรับการกู้คืน
5.  **Complexity vs. Benefit:** สำหรับ project ขนาดเล็ก อย่าพยายาม implement FDIR ที่ซับซ้อนเกินไป ควรเริ่มต้นด้วยกลไกพื้นฐานที่ robust เช่น WDT และ stack overflow check ซึ่งแก้ปัญหาที่พบบ่อยได้ถึง 90% ของ cases และขยายเพิ่มเติมเมื่อจำเป็น

## การจัดการหน่วยความจำอย่างปลอดภัยโดยไม่ใช้การจัดสรรแบบไดนามิก

การจัดการหน่วยความจำ (Memory Management) อย่างมีประสิทธิภาพและปลอดภัยเป็นหัวใจสำคัญในการพัฒนา Flight Software ที่น่าเชื่อถือสำหรับระบบฝังตัว โดยเฉพาะอย่างยิ่งในสภาพแวดล้อมที่ทรัพยากรมีจำกัดอย่าง CubeSat <user> เป้าหมายการวิจัยระบุอย่างชัดเจนว่า "ห้ามใช้ malloc/new" ซึ่งเป็นการตัดสินใจเชิงกลยุทธ์ที่ถูกต้องและจำเป็นอย่างยิ่งสำหรับแพลตฟอร์ม ESP32-S3 <user> การใช้ dynamic memory allocation อย่างไม่ระมัดระวังเป็นสาเหตุหลักของปัญหาที่พบบ่อยใน embedded systems ซึ่งรวมถึง heap fragmentation และ stack overflow [[24](https://stackoverflow.com/questions/71085927/how-to-extend-esp32-heap-size), [26](https://forum.arduino.cc/t/arduino-esp32-guru-meditation-error-stack-overflow/1313770)] การยอมรับข้อจำกัดนี้และออกแบบซอฟต์แวร์ให้ทำงานได้โดยไม่พึ่งพา dynamic allocation เป็นก้าวสำคัญในการสร้างระบบ OBC ที่ robust และสามารถทำงานได้ยาวนานโดยไม่เกิดข้อผิดพลาด

**ทฤษฎี: ทำไม "malloc/new" จึงเป็นอันตราย?**
การใช้ `malloc()` หรือ `new` ในการจัดสรรหน่วยความจำแบบไดนามิก (Dynamic Memory Allocation) ทำให้การจัดการ heap เป็นเรื่องที่ซับซ้อนและมีความเสี่ยงสูง [[24](https://stackoverflow.com/questions/71085927/how-to-extend-esp32-heap-size)]
1.  **Heap Fragmentation:** เป็นปัญหาร้ายแรงที่สุดของ dynamic allocation บน embedded systems [[24](https://stackoverflow.com/questions/71085927/how-to-extend-esp32-heap-size)] ปัญหานี้เกิดขึ้นเมื่อมีการจัดสรรและปล่อยคืนหน่วยความจำหลายครั้ง ทำให้ heap ถูกแบ่งเป็นช่องว่างขนาดเล็กที่ไม่ต่อเนื่องกัน [[27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)] แม้ว่า sum ของช่องว่างทั้งหมดจะมากพอ แต่ถ้าไม่มีช่องว่างใดช่องว่างหนึ่งที่มีขนาดใหญ่พอสำหรับการจัดสรร block ใหม่ ระบบก็จะล้มเหลวในการจัดสรรหน่วยความจำ (return NULL) ซึ่งอาจทำให้เกิดการล่มของระบบได้ [[24](https://stackoverflow.com/questions/71085927/how-to-extend-esp32-heap-size), [27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)] ปัญหานี้จะรุนแรงขึ้นเมื่อมี pattern ที่เร่งให้เกิด fragmentation เช่น การใช้งาน WiFi/BLE stacks, JSON parsing libraries, หรือการสร้าง/delete ของ FreeRTOS tasks ซ้ำๆ [[27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)]
2.  **Stack Overflow:** แต่ละ FreeRTOS task มี stack ของตัวเองที่ถูกจัดสรรจาก heap โดย default [[6](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/mem_alloc.html), [7](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32s3/api-reference/system/mem_alloc.html)] การสร้าง task ที่ใช้ stack มากเกินไป หรือมี function call depth ที่ลึกเกินไป อาจทำให้ stack ของ task นั้นล้น (overflow) ซึ่งจะไปเขียนทับ memory ของ task อื่นหรือ data ของ kernel ทำให้เกิดพฤติกรรมที่ไม่คาดคิดและเป็นอันตราย [[26](https://forum.arduino.cc/t/arduino-esp32-guru-meditation-error-stack-overflow/1313770)] การใช้ `malloc` ภายใน task ที่มี stack usage ใกล้เคียงกับ stack size ที่กำหนดไว้ จะเพิ่มความเสี่ยงนี้เข้าไปอีก
3.  **Memory Leaks:** การลืมที่จะเรียก `free()` หลังจากใช้งาน pointer ที่ `malloc` ไว้ จะทำให้หน่วยความจำที่จัดสรรไปนั้นถูกล็อกไว้และไม่สามารถใช้งานได้อีกเลย แม้จะไม่ได้ใช้งานแล้วก็ตาม [[27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)] การ leak ที่เล็กน้อยอาจดูเหมือนไม่มีปัญหาในระยะสั้น แต่เมื่อระบบทำงานไปนานๆ มันจะสะสมจนหมด heap ทั้งหมดและทำให้ระบบล่ม

**แนวทางปฏิบัติ: Static Memory Allocation Strategy**
เพื่อหลีกเลี่ยงปัญหาทั้งหมดข้างต้น การออกแบบ OBC สำหรับ CubeSat จำลองบน ESP32-S3 ควรใช้ strategy แบบ Static Memory Allocation ทั้งหมด <user> ซึ่งหมายความว่าขนาดและตำแหน่งของหน่วยความจำทั้งหมดจะถูกกำหนดไว้ล่วงหน้าที่เวลาคอมไพล์ (compile time) ไม่ใช่ที่เวลาทำงาน (runtime)

| Component | แนวทางการจัดสรร | เครื่องมือ/ฟังก์ชันใน ESP-IDF |
| :--- | :--- | :--- |
| **Stack ของ Task** | กำหนดขนาด stack ของแต่ละ task ให้เพียงพอต่อการทำงานสูงสุด (worst-case) โดยไม่ต้อง dynamic allocation | `xTaskCreateStaticPinnedToCore()` [[30](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/freertos_idf.html)] |
| **FreeRTOS Object (Queues, Semaphores, Timers)** | สร้าง object ด้วยการ pre-allocate memory buffer ที่ compile time | `xQueueCreateStatic()`, `xSemaphoreCreateBinaryStatic()`, `xTimerCreateStatic()` [[30](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/freertos_idf.html)] |
| **Data Buffers (Circular Buffers, Packet Buffers)** | ประกาศ array ของขนาดที่แน่นอนเป็น global/static variables | `static uint8_t rx_buffer[BUFFER_SIZE];` [[28](https://forum.arduino.cc/t/esp32-how-to-run-a-freertos-task-at-a-specific-hertz-or-frequency/953584)] |
| **Message Payloads** | ใช้ fixed-size struct หรือ array สำหรับ payload ภายใน message queue | `QueueHandle_t xQ_Message = xQueueCreate(1, sizeof(stu_message));` [[28](https://forum.arduino.cc/t/esp32-how-to-run-a-freertos-task-at-a-specific-hertz-or-frequency/953584)] |
| **Objects ที่ถูกสร้าง/ทำลายบ่อยๆ** | ใช้ Memory Pool ที่ pre-allocate ไว้ที่ boot time | `xQueueCreate()` พร้อมกับ array ของ pointer ไปยัง blocks ของ memory [[27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)] |

**Pseudocode: การกำหนดค่าขนาด stack และการสร้าง FreeRTOS Objects แบบ static**
```c
// 1. กำหนดขนาดและสร้าง buffer สำหรับ stack และ data structures ของแต่ละ task
#define ADC_TASK_STACK_SIZE 2048
#define COMM_TASK_STACK_SIZE 4096
#define CONTROL_TASK_STACK_SIZE 2048

StaticTask_t xAdcTaskBuffer;
StackType_t xAdcStack[ADC_TASK_STACK_SIZE];

StaticTask_t xCommTaskBuffer;
StackType_t xCommStack[COMM_TASK_STACK_SIZE];

StaticTask_t xControlTaskBuffer;
StackType_t xControlStack[CONTROL_TASK_STACK_SIZE];

// 2. กำหนด buffer สำหรับ FreeRTOS objects
#define QUEUE_LENGTH 10
#define ITEM_SIZE sizeof(sensor_data_t)

static StaticQueue_t xSensorDataQueueBuffer;
static uint8_t ucQueueStorageArea[QUEUE_LENGTH * ITEM_SIZE];

// 3. ตัวอย่างการสร้าง queue แบบ static
QueueHandle_t xSensorQueue = NULL;

void create_static_objects(void) {
    // สร้าง queue แบบ static
    xSensorQueue = xQueueCreateStatic(
        QUEUE_LENGTH,
        ITEM_SIZE,
        ucQueueStorageArea,
        &xSensorDataQueueBuffer
    );
    
    if (xSensorQueue == NULL) {
        // Handle error: ไม่สามารถสร้าง queue ได้
        while(1) {
            vTaskDelay(pdMS_TO_TICKS(100));
        }
    }
}

// 4. ตัวอย่างการสร้าง task แบบ static
void app_main(void) {
    create_static_objects();
    
    // สร้าง task แบบ static ที่ pin ไปยัง Core 1
    xTaskCreateStaticPinnedToCore(
        adc_task,
        "ADC_Task",
        ADC_TASK_STACK_SIZE,
        NULL,
        5,
        xAdcStack,
        &xAdcTaskBuffer,
        1
    );
    
    xTaskCreateStaticPinnedToCore(
        communication_task,
        "Comm_Task",
        COMM_TASK_STACK_SIZE,
        NULL,
        3,
        xCommStack,
        &xCommTaskBuffer,
        0 // Pin to Core 0
    );
    
    xTaskCreateStaticPinnedToCore(
        control_task,
        "Control_Task",
        CONTROL_TASK_STACK_SIZE,
        NULL,
        4, // Priority between comm and adc
        xControlStack,
        &xControlTaskBuffer,
        1
    );
    
    // เริ่ม scheduler
    vTaskStartScheduler();
}
```

**ทฤษฎี: การจัดการ Circular Buffer**
Circular buffer (หรือ ring buffer) เป็น data structure ที่มีประโยชน์อย่างยิ่งสำหรับการถ่ายโอนข้อมูลระหว่าง Interrupt Service Routine (ISR) และ FreeRTOS task หรือระหว่าง task ต่างๆ <URLRT6YPG> ซึ่งต้องการความปลอดภัยในการเข้าถึงแบบ concurrent การใช้ circular buffer แบบ static คือแนวทางที่ดีที่สุด
*   **Structure:** ประกอบด้วย array ของข้อมูล, two pointers/indexes: `read_index` และ `write_index`
*   **Operation:** เมื่อเขียนข้อมูล เขียนที่ `write_index` แล้วเพิ่ม `write_index` (mod size_of_buffer) ทำเช่นเดียวกับการอ่าน
*   **Advantages:** การจัดสรร memory แบบ static ทำให้ไม่มี risk ของการ heap fragmentation และ stack overflow ที่เกี่ยวข้องกับการจัดสรรใน runtime <URLRT6YPG>[[45](https://github.com/78/uart-uhci)]

**Pseudocode: การใช้ Memory Pool สำหรับการจัดการ Packet**
```c
// สมมติว่าเราต้องการจัดการ packet ขนาด 256 bytes จำนวน 20 ชิ้น
#define PACKET_POOL_SIZE 20
#define PACKET_PAYLOAD_SIZE 256
#define PACKET_OVERHEAD sizeof(void*) // สำหรับ pointer ใน queue

typedef struct {
    void* next; // สำหรับ linked list ใน pool
    uint8_t payload[PACKET_PAYLOAD_SIZE];
} packet_t;

// Buffer static สำหรับทั้งหมด packets
static uint8_t packet_pool_memory[PACKET_POOL_SIZE][PACKET_PAYLOAD_SIZE + PACKET_OVERHEAD];
static QueueHandle_t packet_free_queue = NULL;

// ฟังก์ชันสำหรับ initialize memory pool
void packet_pool_init(void) {
    // สร้าง queue สำหรับ tracking free packets
    packet_free_queue = xQueueCreate(PACKET_POOL_SIZE, sizeof(void*));
    
    for (int i = 0; i < PACKET_POOL_SIZE; i++) {
        void* ptr = &packet_pool_memory[i];
        xQueueSend(packet_free_queue, &ptr, 0); // ส่ง pointer กลับไปยัง pool
    }
}

// ฟังก์ชันสำหรับขอ packet
packet_t* packet_alloc(void) {
    void* ptr;
    if (xQueueReceive(packet_free_queue, &ptr, 0) == pdTRUE) {
        memset(ptr, 0, PACKET_PAYLOAD_SIZE + PACKET_OVERHEAD); // Clear packet
        return (packet_t*)ptr;
    }
    return NULL; // No packet available
}

// ฟังก์ชันสำหรับคืน packet
void packet_free(packet_t* p) {
    void* ptr = (void*)p;
    xQueueSend(packet_free_queue, &ptr, 0); // ส่งกลับไปยัง queue ของ free packets
}
```

**ข้อควรระวัง:**
1.  **Estimate Stack Usage Accurately:** การคำนวณขนาด stack ที่เหมาะสมสำหรับแต่ละ task เป็นสิ่งที่ท้าทาย ควรเริ่มต้นด้วยขนาดที่ใหญ่กว่าที่คาดไว้ แล้วใช้ `uxTaskGetStackHighWaterMark()` เพื่อดูว่ามีการใช้ stack มากที่สุดเท่าใดระหว่างการทำงาน [[31](https://controllerstech.com/esp32-freertos-multitasking-project/)] แล้วปรับขนาดลงให้เหลือ margin ที่ปลอดภัย
2.  **Monitor Heap Fragmentation:** แม้จะไม่ใช้ dynamic allocation แต่ library อื่นๆ (เช่น WiFi, BLE, filesystem) อาจใช้ heap ได้ [[27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)] ควรใช้ฟังก์ชัน ESP-IDF อย่าง `heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)` เพื่อตรวจสอบว่ามีขนาด block ที่ใหญ่พอสำหรับ allocation ครั้งใหญ่ที่สุดหรือไม่ [[25](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32s3/api-reference/system/heap_debug.html), [27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)]
3.  **Use Static Assertions:** ใน C99 หรือ C++11+ สามารถใช้ `_Static_assert` เพื่อตรวจสอบขนาดของ struct หรือ array ที่กำหนดไว้ static ว่าไม่เกินขนาดที่อนุญาตในตอน compile time
4.  **Disable Dynamic Task Creation:** หลีกเลี่ยงการใช้ `xTaskCreate()` หรือการสร้าง task ในลูป `for` หรือ `while` ซึ่งจะกิน heap ทุกครั้งที่ทำงาน [[27](https://hubble.com/community/guides/esp32-memory-fragmentation-why-your-device-crashes-after-running-for-days/)] ควรสร้าง persistent tasks ทั้งหมดที่ `app_main()` หรือใน phase การ initial setup
5.  **Be Aware of Library Behavior:** บางไลบรารีอาจมี wrapper ที่ใช้ `malloc` อยู่เบื้องหลัง ควรตรวจสอบ source code หรือเอกสารของไลบรารีที่ใช้ หรือพยายามหา alternative ที่ไม่ต้องการ dynamic allocation

## การประยุกต์ใช้งานเฉพาะทาง: การติดตามดวงอาทิตย์ และ การถ่ายภาพเป้าหมาย

ภารกิจหลักของ CubeSat จำลองนี้คือการดำเนินการ Sun Tracking และ Target Imaging <user> การประยุกต์ใช้ตรรกะของ OBC ที่ออกแบบขึ้นมา จะถูกนำมาใช้ในชั้น Application Logic โดยเฉพาะใน Payload Mode ของ Finite State Machine <user> ซึ่งจะมี task หรือ module ที่รับผิดชอบหน้าที่เหล่านี้โดยเฉพาะ การวิเคราะห์ในส่วนนี้จะอธิบายตรรกะและสมการที่เกี่ยวข้องกับภารกิจทั้งสอง โดยแยกแยะระหว่างทฤษฎีและสิ่งที่สามารถปรับลดความซับซ้อนได้ในระบบจำลองบนโต๊ะ ซึ่งมีข้อจำกัดจากฮาร์ดแวร์ ESP32-S3

**ทฤษฎี: Sun Tracking**
เป้าหมายของภารกิจนี้คือการควบคุมท่าทิศทางของ CubeSat ให้ชี้ไปยังดวงอาทิตย์อย่างต่อเนื่อง เพื่อให้แผงโซลาร์เซลล์ได้รับแสงแดดอย่างเต็มที่และช่วยให้ระบบพลังงาน (EPS) สามารถชาร์จแบตเตอรี่ได้อย่างมีประสิทธิภาพ <user> ตรรกะพื้นฐานในการควบคุมนี้คือการใช้ Feedback Control Loop ซึ่งโดยทั่วไปจะใช้ PID (Proportional-Integral-Derivative) Controller

สมการสำหรับ PID Controller คือ:
$$ u(t) = K_p e(t) + K_i \int_{0}^{t} e(\tau)d\tau + K_d \frac{de(t)}{dt} $$
โดยที่:
*   $u(t)$: คือ control output ที่จะส่งไปยัง actuator (e.g., reaction wheel, magnetorquer) (หน่วย: Nm หรือ A-m²)
*   $e(t)$: คือ error signal ซึ่งเป็นความแตกต่างระหว่าง desired attitude (setpoint) และ actual measured attitude (หน่วย: radian หรือ degree)
*   $K_p, K_i, K_d$: คือ proportional, integral, และ derivative gains ตามลำดับ (หน่วย: ไม่มีหน่วยสำหรับ K_p, 1/s สำหรับ K_i, s สำหรับ K_d)

ในระบบ digital implementation บน microcontroller สมการจะถูก discretized เป็น:
$$ u[k] = K_p e[k] + K_i \sum_{i=0}^{k} e[i] \Delta t + K_d \frac{e[k] - e[k-1]}{\Delta t} $$
โดยที่ $\Delta t$ คือ sampling time interval (หน่วย: second)

**Pseudocode: Discrete PID Controller Implementation**
```c
// Struct สำหรับ PID controller instance
typedef struct {
    float Kp, Ki, Kd;
    float setpoint;
    float integral;
    float prev_error;
    float dt;
} pid_controller_t;

// Initializer สำหรับ PID controller
void pid_init(pid_controller_t *pid, float Kp, float Ki, float Kd, float dt) {
    pid->Kp = Kp;
    pid->Ki = Ki;
    pid->Kd = Kd;
    pid->setpoint = 0.0;
    pid->integral = 0.0;
    pid->prev_error = 0.0;
    pid->dt = dt;
}

// Function สำหรับคำนวณ PID output
float pid_compute(pid_controller_t *pid, float process_variable) {
    // คำนวณ error
    float error = pid->setpoint - process_variable;
    
    // คำนวณ Integral term
    pid->integral += error * pid->dt;
    
    // จำกัด Integral windup
    // สมมติว่ามีค่า limit ที่เหมาะสม
    const float INTEGRAL_LIMIT = 100.0;
    if (pid->integral > INTEGRAL_LIMIT) pid->integral = INTEGRAL_LIMIT;
    else if (pid->integral < -INTEGRAL_LIMIT) pid->integral = -INTEGRAL_LIMIT;
    
    // คำนวณ Derivative term
    float derivative = (error - pid->prev_error) / pid->dt;
    
    // คำนวณ final output
    float output = pid->Kp * error + pid->Ki * pid->integral + pid->Kd * derivative;
    
    // Update previous error
    pid->prev_error = error;
    
    return output;
}

// ใน task หลักที่ควบคุมการหมุน
void sun_tracking_task(void *pvParameters) {
    pid_controller_t sun_pid;
    float control_signal;
    
    // ตั้งค่า PID gains และ parameters
    pid_init(&sun_pid, 2.0, 0.1, 0.05, 0.001); // dt = 1ms
    sun_pid.setpoint = 0.0; // ต้องการให้ error เป็น 0 (satellite body axis aligned with sun)
    
    while(1) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY); // รอการแจ้งเตือนจาก timer ISR
        
        // 1. Read sensor data (e.g., from sun sensors or ADACS)
        // สมมติว่าเรามีฟังก์ชันนี้ที่อ่านค่าท่าทิศทางปัจจุบัน
        float current_attitude = read_sun_sensor_angle(); // หน่วย: radian
        
        // 2. Compute control signal using PID
        control_signal = pid_compute(&sun_pid, current_attitude);
        
        // 3. Send control signal to actuator
        // สมมติว่ามีฟังก์ชันนี้ที่ส่งสัญญาณไปยัง reaction wheel driver
        apply_torque_to_actuator(control_signal);
    }
}
```

**Simplification for Tabletop Simulator:**
1.  **Actuator Model:** แทนที่จะควบคุม reaction wheel ที่ซับซ้อน สามารถใช้ actuator แบบจำลองที่ง่ายกว่า เช่น servo motor ที่เชื่อมต่อกับ ESP32 ผ่าน PWM ซึ่งจะชี้ไปที่แหล่งกำเนิดแสงเทียม
2.  **Sensor Model:** แทนที่จะใช้ sun sensor จริง สามารถใช้ ADC ที่อ่านค่าจาก LDR (Light Dependent Resistor) หรือ photodiode ที่จัดวางไว้ในทิศทางต่างๆ เพื่อประมาณทิศทางของแสง <user>[[49](https://www.makerfabs.com/blog/post/cautions-in-using-esp32-adc-makerfabs-2?srsltid=AfmBOopiZemmcZHKVweluZLFFvE4kpDQBskLbDYBTvFU8csSLWmxPoOT)]
3.  **Control Law Simplification:** แทนที่จะใช้ full PID อาจเริ่มต้นด้วย P-only controller หรือ even simpler bang-bang control ซึ่งจะสั่งงาน actuator ไปในทิศทางที่ error เป็นบวก หรือสั่งงานในทิศทางตรงกันข้ามถ้า error เป็นลบ

**ทฤษฎี: Target Imaging**
ภารกิจนี้เกี่ยวข้องกับการถ่ายภาพวัตถุเป้าหมายที่กำหนดไว้ <user> ตรรกะพื้นฐานประกอบด้วย:
1.  **Pointing:** ควบคุมท่าทิศทางของ CubeSat ให้ชี้ไปยังพิกัดของเป้าหมายบนท้องฟ้า
2.  **Imaging Sequence:** บังคับใช้ชุดคำสั่งสำหรับการถ่ายภาพ (e.g., ตั้งค่าค่า exposure, บันทึกภาพ, ตรวจสอบความสมบูรณ์ของไฟล์)
3.  **Data Downlink:** ส่งภาพที่ถ่ายได้กลับมายังภาคพื้นดิน

**Pseudocode: Imaging Sequence Manager**
```c
typedef enum {
    IMAGING_IDLE,
    IMAGING_POINTING,
    IMAGING_EXPOSING,
    IMAGING_SAVING,
    IMAGING_COMPLETE,
    IMAGING_FAILED
} imaging_state_t;

void target_imaging_task(void *pvParameters) {
    imaging_state_t state = IMAGING_IDLE;
    const uint32_t exposure_time_ms = 1000; // Exposure duration
    bool image_capture_successful = false;

    while(1) {
        switch(state) {
            case IMAGING_IDLE:
                // รอคำสั่ง Start Imaging จาก command queue
                if (command_available(CMD_START_IMAGING)) {
                    // ตั้งค่าพารามิเตอร์เป้าหมาย
                    // ...
                    state = IMAGING_POINTING;
                }
                break;

            case IMAGING_POINTING:
                // ใช้ ADCS/FSM ในการควบคุมท่าทิศทางไปยังเป้าหมาย
                if (is_pointing_stable()) {
                    state = IMAGING_EXPOSING;
                }
                break;

            case IMAGING_EXPOSING:
                // 1. แจ้งเตือน payload (camera module) ให้เริ่มการถ่ายภาพ
                camera_start_exposure(exposure_time_ms);
                
                // 2. รอให้การถ่ายภาพเสร็จสิ้น (ใช้ vTaskDelay หรือ notification)
                if (camera_exposure_complete()) {
                    image_capture_successful = true;
                    state = IMAGING_SAVING;
                }
                break;

            case IMAGING_SAVING:
                // 1. ดึงภาพจาก buffer ของ camera
                // 2. บันทึกภาพลงใน storage medium (e.g., SD card via SPI)
                if (camera_save_image_to_sd()) {
                    state = IMAGING_COMPLETE;
                } else {
                    state = IMAGING_FAILED;
                }
                break;

            case IMAGING_COMPLETE:
                // ส่ง telemetry แจ้งว่าการถ่ายภาพสำเร็จ
                send_imaging_completion_telemetry(image_capture_successful);
                state = IMAGING_IDLE;
                break;

            case IMAGING_FAILED:
                // ส่ง telemetry แจ้งว่าการถ่ายภาพล้มเหลว
                send_imaging_failure_telemetry();
                state = IMAGING_IDLE;
                break;
        }
        
        vTaskDelay(pdMS_TO_TICKS(100)); // Small delay to prevent tight spinning
    }
}
```

**ข้อควรระวัง (Caution):**
1.  **Timing Precision:** การถ่ายภาพที่ประสบความสำเร็จต้องอาศัยการประสานเวลาที่แม่นยำระหว่าง actuator, shutter, และ storage system <user> การใช้ `vTaskDelay()` อาจไม่เพียงพอสำหรับงานที่ต้องการความแม่นยำระดับไมโครวินาที [[20](https://community.simplefoc.com/t/has-anyone-tried-running-simplefoc-on-esp32-s3-with-multitasking/7455)] ควรใช้ Hardware Timer Interrupts หรือ ESP32's RMT (Remote Control) module สำหรับการ generate pulse ที่แม่นยำ
2.  **Resource Intensity:** การประมวลผลภาพ (ถ้ามี) หรือการบันทึกข้อมูลขนาดใหญ่ลงใน SD card อาจกิน CPU และ RAM จำนวนมาก [[11](https://www.scottyob.com/post/2025-02-27-esp32-memory/)] ควรมีการจัดการ task priorities และ resource access อย่างระมัดระวังเพื่อไม่ให้ส่งผลกระทบต่อ stability ของ OBC
3.  **Camera Sensor Limitations:** หากใช้ camera module ที่เชื่อมต่อด้วย USB หรือ MIPI CSI-2 บน ESP32-S3 อาจมีข้อจำกัดด้าน bandwidth และ driver support <user> ควรเลือกใช้ camera module ที่มี driver ที่เสถียรและสามารถควบคุมได้ผ่าน SPI หรือ I2C ซึ่งเป็น interface ที่เสถียรกว่า
4.  **Thermal Management:** การทำงานหนักของ CPU และ actuator เป็นเวลานานอาจทำให้เกิดความร้อนสะสมได้ [[13](https://innovationspace.ansys.com/knowledge/forums/topic/an-introduction-to-space-software-standards-ecss-e-st-40-and-ecss-q-st-80c/)] ควรติดตาม internal temperature ของ ESP32 และอาจมีกลไกในการลดประสิทธิภาพหรือหยุดภารกิจชั่วคราวหากอุณหภูมิสูงเกินเกณฑ์
5.  **Ground Segment Interaction:** ภารกิจการถ่ายภาพควรสื่อสารกับภาคพื้นดินอย่างสมบูรณ์ โดยส่ง beacon ที่มีสถานะของภารกิจ (idle, pointing, exposing, etc.) และส่ง telemetries ที่ละเอียดเกี่ยวกับผลลัพธ์ของการถ่ายภาพ (success/fail, file size, etc.) เพื่อให้ ground team สามารถตัดสินใจและวางแผนการถ่ายภาพครั้งต่อไปได้