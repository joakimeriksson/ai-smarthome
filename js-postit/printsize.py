import os, sys
import PyPDF2

def print_pdf_page_sizes(folder_path):
    warnings = []
    # List all files in the provided folder
    for filename in os.listdir(folder_path):
        if filename.endswith('.pdf'):
            # Construct full file path
            file_path = os.path.join(folder_path, filename)
            try:
                # Open the PDF file
                with open(file_path, 'rb') as file:
                    pdf_reader = PyPDF2.PdfReader(file)
                    # Iterate through each page of the PDF
                    for page_num in range(len(pdf_reader.pages)):
                        page = pdf_reader.pages[page_num]
                        # Get the page size
                        page_size = page.mediabox
                        # Ensure the values are floats
                        width_pt = float(page_size[2])
                        height_pt = float(page_size[3])
                        # Convert dimensions from points to millimeters
                        width_mm = width_pt * 0.3528  # Convert upper-right x-coordinate
                        height_mm = height_pt * 0.3528  # Convert upper-right y-coordinate
                        type = "Unknown  (possibly rotated?)"
                        if width_mm > 840 and width_mm < 842 and height_mm > 1188 and height_mm < 1191:
                            type = "A0"
                        elif width_mm > 699 and width_mm < 701 and height_mm > 999 and height_mm < 1001:
                            type = "700x1000"
                        elif width_mm > 699 and width_mm < 701 and height_mm > 849 and height_mm < 851:
                            type = "WARNING - Probably failed use of footer - tool"
                            warnings.append(filename)
                        elif width_mm > 593 and width_mm < 595 and height_mm > 840 and height_mm < 842:
                            type = "A1 - WARNING Should be A0"
                        elif width_mm > 419 and width_mm < 421 and height_mm > 593 and height_mm < 595:
                            type = "A2 - WARNING should be A0"
                        else:
                            type = "WARNING - Too small poster???"
                        # Print page size in millimeters
                        print(f"Width = {width_mm:.2f}mm,\tHeight = {height_mm:.2f} mm,\tFilename: {filename}, Page {page_num + 1}:   Type:{type}")
            except Exception as e:
                print(f"Failed to read {filename}: {str(e)}")
    return warnings

# Replace 'path_to_folder' with the path to the folder containing PDFs

warnings = print_pdf_page_sizes(sys.argv[1])

print(warnings)