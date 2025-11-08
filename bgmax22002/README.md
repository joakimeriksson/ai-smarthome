# ISO 20022 Payment File Parser

This Java library provides a parser for ISO 20022 payment files that will replace the traditional BGMAX format used by Swedish banks from March 2026.

## Background

Swedish banks are transitioning from the legacy Bankgiro formats (BGMAX, LB, KI) to the international ISO 20022 XML standard. This change will be completed during 2026, with most banks setting their deadlines around mid-2026.

## Supported Formats

This parser supports two ISO 20022 message types:

- **camt.053** - Bank to Customer Account Statement
  - End-of-day account statements with all transactions
  - Replaces the traditional BGMAX format for daily reconciliation

- **camt.054** - Bank to Customer Debit/Credit Notification
  - Real-time payment notifications
  - Immediate alerts for incoming/outgoing payments

## Features

- Parse ISO 20022 XML files (camt.053 and camt.054)
- Extract payment information including:
  - Transaction amounts and currencies
  - Debtor and creditor details (names, IBANs)
  - OCR references for automatic reconciliation
  - Remittance information
  - Booking and value dates
  - Bank transaction codes
- Opening and closing balances (camt.053)
- No external dependencies - uses standard Java XML parsing

## Project Structure

```
bgmax22002/
├── src/
│   ├── main/
│   │   ├── java/se/joakimeriksson/iso20022/
│   │   │   ├── Payment.java              # Payment transaction model
│   │   │   ├── AccountStatement.java     # Account statement model
│   │   │   └── ISO20022Parser.java       # Main parser implementation
│   │   └── resources/
│   │       ├── example-camt053.xml       # Example camt.053 file
│   │       └── example-camt054.xml       # Example camt.054 file
│   └── test/
│       └── java/                         # Test classes (add your tests here)
└── README.md
```

## Usage

### Basic Usage

```java
import se.joakimeriksson.iso20022.ISO20022Parser;
import se.joakimeriksson.iso20022.AccountStatement;
import se.joakimeriksson.iso20022.Payment;

// Create parser instance
ISO20022Parser parser = new ISO20022Parser();

// Parse from file
AccountStatement statement = parser.parseFile("path/to/camt053.xml");

// Access statement information
System.out.println("Statement ID: " + statement.getStatementId());
System.out.println("Account: " + statement.getAccountIban());
System.out.println("Opening Balance: " + statement.getOpeningBalance());
System.out.println("Closing Balance: " + statement.getClosingBalance());

// Process payments
for (Payment payment : statement.getPayments()) {
    System.out.println("Amount: " + payment.getAmount() + " " + payment.getCurrency());
    System.out.println("Debtor: " + payment.getDebtorName());
    System.out.println("OCR Reference: " + payment.getOcrReference());
    System.out.println("Remittance Info: " + payment.getRemittanceInformation());
}
```

### Parse from InputStream

```java
import java.io.FileInputStream;
import java.io.InputStream;

try (InputStream is = new FileInputStream("payment.xml")) {
    AccountStatement statement = parser.parseStream(is);
    // Process statement...
}
```

### Command Line Usage

```bash
# Compile the parser
javac -d bin src/main/java/se/joakimeriksson/iso20022/*.java

# Run with example file
java -cp bin se.joakimeriksson.iso20022.ISO20022Parser src/main/resources/example-camt053.xml
```

## Payment Information

The `Payment` class contains all relevant information from a transaction:

| Field | Description | Corresponds to BGMAX |
|-------|-------------|---------------------|
| `amount` | Transaction amount | Beloppsfält |
| `currency` | Currency code (e.g., SEK) | Valuta |
| `ocrReference` | OCR/Payment reference | OCR-nummer |
| `debtorName` | Payer name | Betalare |
| `debtorAccount` | Payer IBAN | Betalarens konto |
| `creditorName` | Receiver name | Mottagare |
| `creditorAccount` | Receiver IBAN | Mottagarens konto |
| `remittanceInformation` | Payment message | Meddelande |
| `bookingDate` | Transaction booking date | Bokföringsdatum |
| `valueDate` | Value date | Valutadatum |
| `creditDebitIndicator` | Credit/Debit flag | In/Ut-betalning |

## Example Files

The `src/main/resources/` directory contains example XML files:

- **example-camt053.xml** - Complete account statement with 3 transactions (2 credits, 1 debit)
- **example-camt054.xml** - Payment notification for a single incoming payment

These files demonstrate the typical structure of ISO 20022 files from Swedish banks.

## Building the Project

### With Maven

Create a `pom.xml` file and add this as a dependency, then:

```bash
mvn clean compile
mvn test
```

### Without Build Tool

```bash
# Compile
javac -d bin src/main/java/se/joakimeriksson/iso20022/*.java

# Run tests (after creating test classes)
javac -cp bin -d bin src/test/java/*.java
java -cp bin org.junit.runner.JUnitCore YourTestClass
```

## Migration from BGMAX

Key differences when migrating from BGMAX:

1. **Format**: Text-based BGMAX → XML-based ISO 20022
2. **Structure**: Fixed-width fields → Structured XML elements
3. **References**: OCR numbers are in `CdtrRefInf/Ref` or `Ustrd` elements
4. **IBANs**: Swedish account numbers → IBAN format (SE + 22 digits)
5. **Dates**: Multiple date formats → ISO 8601 (YYYY-MM-DD)
6. **Encoding**: ISO-8859-1 → UTF-8 (limited to ISO-8859-1 characters)

## ISO 20022 Resources

- [ISO 20022 Standard](https://www.iso20022.org/)
- [Swedbank ISO 20022 Information](https://www.swedbank.com/corporate/cash-management-transaction-services/p27.html)
- [Handelsbanken ISO 20022 Documentation](https://www.handelsbanken.com/en/our-services/digital-services/global-gateway/iso-20022-xml)
- [SEB P27 Nordic Payments](https://sebgroup.com/our-offering/transaction-services/p27)

## Timeline

- **Q2 2026**: Transition begins
- **July 1, 2026**: Some banks stop supporting Bankgiro file communication
- **September 1, 2026**: Phase-out of outgoing Bankgiro products
- **End 2026**: Full transition completed

## License

This code is provided as-is for parsing ISO 20022 payment files. Feel free to modify and use in your projects.

## Author

Joakim Eriksson
